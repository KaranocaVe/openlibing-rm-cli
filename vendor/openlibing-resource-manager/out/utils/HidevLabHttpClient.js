"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHidevLabHttpClient = exports.HidevLabHttpClient = void 0;
const axios_1 = __importDefault(require("axios"));
const Logger_1 = __importDefault(require("./Logger"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * HidevLab HTTP 客户端
 * 统一处理 HidevLab API 请求，自动添加 sessionId header
 */
class HidevLabHttpClient {
    constructor(baseURL, environment = 'prod') {
        this.customHeaders = {};
        this.apiSignatures = {};
        // 禁用 SSL 证书校验
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        this.baseURL = baseURL;
        this.environment = environment;
        // 加载自定义 headers（所有环境都需要，prod 环境需要 Referer）
        this.loadCustomHeaders();
        this.axiosInstance = axios_1.default.create({
            baseURL: baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                // 明确设置为 identity，表示不接受压缩
                'Accept-Encoding': 'identity'
            },
            // 启用自动解压缩，让 axios 处理压缩响应
            decompress: true,
            // 确保响应数据正确处理
            transformResponse: [(data) => {
                    // 如果数据是字符串，尝试解析为 JSON
                    if (typeof data === 'string') {
                        try {
                            return JSON.parse(data);
                        }
                        catch (e) {
                            return data;
                        }
                    }
                    return data;
                }]
        });
        // 请求拦截器：自动添加 sessionId 和自定义 headers
        this.axiosInstance.interceptors.request.use((config) => {
            // 确保 Accept-Encoding 保持为 identity（不接受压缩）
            if (config.headers) {
                config.headers['Accept-Encoding'] = 'identity';
            }
            // 如果请求没有手动设置 Cookie header，自动添加 sessionId
            if (!config.headers || !config.headers['Cookie']) {
                const sessionId = this.getSessionId();
                if (sessionId) {
                    config.headers['Cookie'] = `sessionId=${sessionId}`;
                }
                else {
                    Logger_1.default.debug('请求未找到 sessionId');
                }
            }
            else {
                // 请求已带 Cookie，跳过自动添加
            }
            // 所有环境都添加 Referer
            if (this.customHeaders['Referer']) {
                config.headers['Referer'] = this.customHeaders['Referer'];
            }
            // 如果是 beta 或 alpha 环境，添加额外的自定义 headers
            if (this.environment === 'beta' || this.environment === 'alpha') {
                if (this.customHeaders['X-HW-ID']) {
                    config.headers['X-HW-ID'] = this.customHeaders['X-HW-ID'];
                }
                // 根据 URL 路径选择对应的签名
                const requestUrl = config.url || '';
                let signatureAdded = false;
                for (const [urlPattern, signature] of Object.entries(this.apiSignatures)) {
                    if (requestUrl.includes(urlPattern)) {
                        config.headers['X-HW-SIGN'] = signature;
                        signatureAdded = true;
                        break;
                    }
                }
                if (!signatureAdded) {
                    Logger_1.default.debug(`未找到匹配的签名，URL: ${requestUrl}`);
                }
                if (this.customHeaders['X-HW-DATE']) {
                    config.headers['X-HW-DATE'] = this.customHeaders['X-HW-DATE'];
                }
            }
            return config;
        }, (error) => {
            Logger_1.default.error('请求拦截器错误', error);
            return Promise.reject(error);
        });
        // 响应拦截器：统一处理错误和 401 自动刷新
        this.axiosInstance.interceptors.response.use(async (response) => {
            const { data } = response;
            const originalRequest = response.config;
            // 检查业务层 401 错误（HTTP 200 但 response.data.code === 401）
            if (data && data.code === 401 && !originalRequest._retry) {
                // 服务器返回错误状态码
                Logger_1.default.error(`API 错误 [${data.code}]:`, data.data);
                // 如果当前请求是刷新 token 的请求（/hwaccount/accessToken），不要重试
                // refreshToken 本身已过期，需要清除用户信息并提示重新登录
                if (originalRequest.url?.includes('/hwaccount/accessToken')) {
                    Logger_1.default.warning('RefreshToken 请求返回 401，refreshToken 已过期，清除用户信息');
                    // 异步处理 token 过期（不阻塞当前请求）
                    this.handleTokenExpiredAsync();
                    return Promise.reject(new Error('RefreshToken 已过期'));
                }
                originalRequest._retry = true;
                Logger_1.default.warning('sessionId 无效或已过期，尝试刷新 token');
                try {
                    const refreshed = await this.handleTokenRefresh();
                    if (refreshed) {
                        // 刷新成功，重试原请求
                        const newSessionId = this.getSessionId();
                        if (newSessionId) {
                            originalRequest.headers['Cookie'] = `sessionId=${newSessionId}`;
                        }
                        return this.axiosInstance(originalRequest);
                    }
                    else {
                        // 刷新失败，说明 refreshToken 也过期了
                        Logger_1.default.error('Token 刷新失败，用户需要重新登录');
                        // 异步处理 token 过期（不阻塞当前请求）
                        this.handleTokenExpiredAsync();
                        return Promise.reject(new Error('登录已过期，请重新登录'));
                    }
                }
                catch (refreshError) {
                    Logger_1.default.error('Token 刷新过程出错', refreshError);
                    // 异步处理 token 过期（不阻塞当前请求）
                    this.handleTokenExpiredAsync();
                    return Promise.reject(new Error('登录已过期，请重新登录'));
                }
            }
            return response;
        }, (error) => {
            if (error.request) {
                // 请求已发送但没有收到响应
                Logger_1.default.error('API 请求超时或无响应:', error.message);
            }
            else {
                // 其他错误
                Logger_1.default.error('API 请求错误:', error.message);
            }
            return Promise.reject(error);
        });
    }
    /**
     * 从 .vscode/.env 文件加载自定义 headers
     */
    loadCustomHeaders() {
        try {
            // 首先根据环境设置 Referer（无论是否有工作区都要设置）
            if (this.environment === 'alpha') {
                this.customHeaders['Referer'] = 'https://lab-alpha.rnd.huawei.com/';
            }
            else if (this.environment === 'alpha_yellow') {
                this.customHeaders['Referer'] = 'https://lab-alpha.rnd.huawei.com/';
            }
            else if (this.environment === 'beta') {
                this.customHeaders['Referer'] = 'https://lab-beta.rnd.huawei.com/';
            }
            else {
                // prod 环境或未指定环境，使用生产环境 Referer
                this.customHeaders['Referer'] = 'https://hidevlab.huawei.com';
            }
            const vscode = require('vscode');
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                Logger_1.default.warning('[CustomHeaders] 未找到工作区，使用默认 Referer');
                return;
            }
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const envPath = path.join(workspaceRoot, '.vscode', '.env');
            if (!fs.existsSync(envPath)) {
                Logger_1.default.warning(`[CustomHeaders] .env 文件不存在: ${envPath}，使用默认 Referer`);
                return;
            }
            const envContent = fs.readFileSync(envPath, 'utf-8');
            // 读取 X-HW-ID
            const hwIdMatch = envContent.match(/X-HW-ID\s*=\s*(.+)/);
            if (hwIdMatch) {
                this.customHeaders['X-HW-ID'] = hwIdMatch[1].trim();
            }
            // 读取各个接口的签名
            const signaturePatterns = [
                { key: 'connect', envKey: 'X-HW-CONNECT-SIGN', urlPattern: '/localIde/connect' },
                { key: 'checkStatus', envKey: 'X-HW-CHECKSTATUS-SIGN', urlPattern: '/localIde/checkStatus' },
                { key: 'start', envKey: 'X-HW-START-SIGN', urlPattern: '/localIde/start' },
                { key: 'stop', envKey: 'X-HW-STOP-SIGN', urlPattern: '/localIde/stop' },
                { key: 'delete', envKey: 'X-HW-DELETE-SIGN', urlPattern: '/localIde/delete' },
                { key: 'refreshToken', envKey: 'X-HW-REFRESH-SIGN', urlPattern: '/hwaccount/refreshToken' },
                { key: 'accessToken', envKey: 'X-HW-ACCESSTOKEN-SIGN', urlPattern: '/hwaccount/accessToken' }
            ];
            signaturePatterns.forEach(pattern => {
                const regex = new RegExp(`${pattern.envKey}\\s*=\\s*(.+)`);
                const match = envContent.match(regex);
                if (match) {
                    this.apiSignatures[pattern.urlPattern] = match[1].trim();
                }
            });
            // 读取 X-HW-DATE
            const hwDateMatch = envContent.match(/X-HW-DATE\s*=\s*(.+)/);
            if (hwDateMatch) {
                this.customHeaders['X-HW-DATE'] = hwDateMatch[1].trim();
            }
            Logger_1.default.info(`[CustomHeaders] 自定义 headers 加载成功，环境: ${this.environment}`);
        }
        catch (error) {
            Logger_1.default.error('[CustomHeaders] 加载自定义 headers 失败', error);
            // 即使出错，也确保设置了 Referer
            if (!this.customHeaders['Referer']) {
                this.customHeaders['Referer'] = 'https://hidevlab.huawei.com';
            }
        }
    }
    /**
     * 获取 sessionId（从全局 authService）
     */
    getSessionId() {
        const authService = global.authService;
        if (authService && typeof authService.getHidevLabSessionId === 'function') {
            return authService.getHidevLabSessionId();
        }
        return null;
    }
    /**
     * 清空用户信息（认证失败时调用）
     */
    clearUserInfo() {
        const authService = global.authService;
        if (authService && typeof authService.clearHidevLabAuth === 'function') {
            authService.clearHidevLabAuth();
            Logger_1.default.info('已清空用户信息');
        }
        else {
            Logger_1.default.warning('AuthService 未初始化或不支持清除认证');
        }
    }
    /**
     * 处理 token 刷新
     */
    async handleTokenRefresh() {
        const authService = global.authService;
        if (authService && typeof authService.refreshHidevLabToken === 'function') {
            return await authService.refreshHidevLabToken();
        }
        Logger_1.default.error('AuthService 未初始化或不支持 token 刷新');
        return false;
    }
    /**
     * 处理 token 过期（清除用户信息并提示重新登录）
     */
    async handleTokenExpired() {
        const authService = global.authService;
        if (authService && typeof authService.handleHidevLabTokenExpired === 'function') {
            await authService.handleHidevLabTokenExpired();
            Logger_1.default.info('已处理 token 过期');
        }
        else {
            Logger_1.default.warning('AuthService 未初始化或不支持处理 token 过期');
        }
    }
    /**
     * 异步处理 token 过期（不阻塞当前请求）
     */
    handleTokenExpiredAsync() {
        // 使用 setTimeout 确保不阻塞当前请求的 reject
        setTimeout(() => {
            this.handleTokenExpired().catch(error => {
                Logger_1.default.error('异步处理 token 过期失败', error);
            });
        }, 0);
    }
    /**
     * GET 请求
     */
    async get(url, config) {
        return this.axiosInstance.get(url, config);
    }
    /**
     * POST 请求y
     */
    async post(url, data, config) {
        return this.axiosInstance.post(url, data, config);
    }
    /**
     * PUT 请求
     */
    async put(url, data, config) {
        return this.axiosInstance.put(url, data, config);
    }
    /**
     * DELETE 请求
     */
    async delete(url, config) {
        return this.axiosInstance.delete(url, config);
    }
    /**
     * 获取基础 URL
     */
    getBaseURL() {
        return this.baseURL;
    }
    /**
     * 设置基础 URL
     */
    setBaseURL(baseURL) {
        this.baseURL = baseURL;
        this.axiosInstance.defaults.baseURL = baseURL;
    }
}
exports.HidevLabHttpClient = HidevLabHttpClient;
/**
 * 创建 HidevLab HTTP 客户端实例
 */
function createHidevLabHttpClient(environment = 'prod') {
    let baseURL;
    switch (environment) {
        case 'alpha':
            baseURL = 'https://apigw-beta.huawei.com/api/alpha';
            break;
        case 'alpha_yellow':
            baseURL = 'https://lab-alpha.rnd.huawei.com';
            break;
        case 'beta':
            baseURL = 'https://lab-beta.rnd.huawei.com';
            break;
        case 'prod':
        default:
            baseURL = 'https://hidevlab.huawei.com';
            break;
    }
    return new HidevLabHttpClient(baseURL, environment);
}
exports.createHidevLabHttpClient = createHidevLabHttpClient;
//# sourceMappingURL=HidevLabHttpClient.js.map