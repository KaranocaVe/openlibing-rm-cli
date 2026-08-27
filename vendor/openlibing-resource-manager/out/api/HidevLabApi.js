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
exports.HidevLabApi = void 0;
const Logger_1 = __importDefault(require("../utils/Logger"));
const HidevLabHttpClient_1 = require("../utils/HidevLabHttpClient");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * HidevLab API 服务
 * 用于与 HidevLab 平台交互
 */
class HidevLabApi {
    /**
     * 初始化配置（插件加载时调用一次）
     * 从工作区根目录下的 .vscode/.env 文件读取 DEBUG 和 ENVIRONMENT 配置
     */
    static initDebugMode() {
        if (this.debugMode !== null && this.environment !== null) {
            return; // 已经初始化过
        }
        try {
            // 获取当前工作区根目录
            const vscode = require('vscode');
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                Logger_1.default.warning('[Config] 未找到工作区，使用默认值 DEBUG=false, ENVIRONMENT=prod');
                this.debugMode = false;
                this.environment = 'prod';
                return;
            }
            // 检查第一个工作区的 .vscode/.env 文件
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const envPath = path.join(workspaceRoot, '.vscode', '.env');
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf-8');
                // 读取 DEBUG 配置
                const debugMatch = envContent.match(/DEBUG\s*=\s*(\w+)/);
                if (debugMatch) {
                    this.debugMode = debugMatch[1].toLowerCase() === 'true';
                }
                else {
                    this.debugMode = false;
                }
                // 读取 ENVIRONMENT 配置
                const envMatch = envContent.match(/ENVIRONMENT\s*=\s*(\w+)/);
                if (envMatch) {
                    const env = envMatch[1].toLowerCase();
                    if (env === 'beta') {
                        this.environment = 'beta';
                    }
                    else if (env === 'alpha') {
                        this.environment = 'alpha';
                    }
                    else if (env === 'alpha_yellow') {
                        this.environment = 'alpha_yellow';
                    }
                    else {
                        this.environment = 'prod';
                    }
                }
                else {
                    this.environment = 'prod';
                }
                return;
            }
            Logger_1.default.warning('[Config] 未找到 .vscode/.env 文件，使用默认值 DEBUG=false, ENVIRONMENT=prod');
            this.debugMode = false;
            this.environment = 'prod';
        }
        catch (error) {
            Logger_1.default.error('[Config] 读取 .vscode/.env 文件失败', error);
            this.debugMode = false;
            this.environment = 'prod';
        }
    }
    /**
     * 检查是否启用 Debug 模式（从缓存读取）
     */
    static isDebugMode() {
        if (this.debugMode === null) {
            this.initDebugMode();
        }
        return this.debugMode;
    }
    /**
     * 获取环境配置（从缓存读取）
     */
    static getEnvironment() {
        if (this.environment === null) {
            this.initDebugMode();
        }
        return this.environment;
    }
    /**
     * 加载 Mock 数据
     */
    static loadMockData() {
        if (this.mockData) {
            return this.mockData;
        }
        try {
            const possiblePaths = [
                path.join(__dirname, 'hidevlab.mock.json'),
                path.join(__dirname, '..', '..', 'src', 'mock', 'hidevlab.mock.json'),
                path.join(process.cwd(), 'src', 'mock', 'hidevlab.mock.json')
            ];
            for (const filePath of possiblePaths) {
                if (fs.existsSync(filePath)) {
                    const fileContent = fs.readFileSync(filePath, 'utf-8');
                    this.mockData = JSON.parse(fileContent);
                    return this.mockData;
                }
            }
            throw new Error('[Mock] 数据文件未找到');
        }
        catch (error) {
            Logger_1.default.error('[Mock] 加载数据失败', error);
            throw error;
        }
    }
    /**
     * 根据 key 获取 Mock 数据
     */
    static async getMockData(key, delay = 1000) {
        // 模拟网络延迟
        await new Promise(resolve => setTimeout(resolve, delay));
        const data = this.loadMockData();
        if (!(key in data)) {
            throw new Error(`[Mock] 数据 key 不存在: ${key}`);
        }
        return data[key];
    }
    /**
     * 获取 HidevLab HTTP 客户端实例
     * baseURL 根据 .vscode/.env 中的 ENVIRONMENT 参数决定
     */
    static getHttpClient() {
        if (!this.httpClient) {
            // 从 .vscode/.env 读取环境配置
            const env = this.getEnvironment();
            this.httpClient = (0, HidevLabHttpClient_1.createHidevLabHttpClient)(env);
        }
        return this.httpClient;
    }
    /**
     * 读取本地 SSH 公钥（只支持 RSA 密钥）
     */
    static async readLocalPublicKey() {
        try {
            const vscode = require('vscode');
            const homedir = os.homedir();
            const sshDir = path.join(homedir, '.ssh');
            // 检查 .ssh 目录是否存在，不存在则创建
            if (!fs.existsSync(sshDir)) {
                Logger_1.default.info('SSH 目录不存在，创建目录...');
                fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
            }
            // 只读取 id_rsa.pub 公钥文件
            const publicKeyPath = path.join(sshDir, 'id_rsa.pub');
            const privateKeyPath = path.join(sshDir, 'id_rsa');
            const publicKeyExists = fs.existsSync(publicKeyPath);
            const privateKeyExists = fs.existsSync(privateKeyPath);
            // 情况1：公钥和私钥都不存在，自动生成
            if (!publicKeyExists && !privateKeyExists) {
                Logger_1.default.info('RSA 密钥对不存在，自动生成...');
                this.generateSSHKeyPair(sshDir);
                // 检查是否生成成功
                if (!fs.existsSync(publicKeyPath)) {
                    throw new Error('生成 RSA 密钥对失败');
                }
                const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
                Logger_1.default.info('成功生成并读取 RSA 公钥: id_rsa.pub');
                return publicKey;
            }
            // 情况2：只有公钥没有私钥
            if (publicKeyExists && !privateKeyExists) {
                Logger_1.default.warning('检测到 id_rsa.pub 存在但 id_rsa 私钥缺失');
                const choice = await vscode.window.showWarningMessage('检测到 RSA 公钥存在但私钥缺失，密钥对不完整。需要删除现有公钥并重新生成密钥对。', '删除并重新生成', '取消');
                if (choice === '删除并重新生成') {
                    fs.unlinkSync(publicKeyPath);
                    Logger_1.default.info('已删除不完整的公钥文件，重新生成密钥对...');
                    this.generateSSHKeyPair(sshDir);
                    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
                    Logger_1.default.info('成功重新生成并读取 RSA 公钥');
                    return publicKey;
                }
                else {
                    throw new Error('用户取消操作，无法继续');
                }
            }
            // 情况3：只有私钥没有公钥
            if (!publicKeyExists && privateKeyExists) {
                Logger_1.default.warning('检测到 id_rsa 私钥存在但 id_rsa.pub 公钥缺失');
                const choice = await vscode.window.showWarningMessage('检测到 RSA 私钥存在但公钥缺失，密钥对不完整。需要删除现有私钥并重新生成密钥对。', '删除并重新生成', '取消');
                if (choice === '删除并重新生成') {
                    fs.unlinkSync(privateKeyPath);
                    Logger_1.default.info('已删除不完整的私钥文件，重新生成密钥对...');
                    this.generateSSHKeyPair(sshDir);
                    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
                    Logger_1.default.info('成功重新生成并读取 RSA 公钥');
                    return publicKey;
                }
                else {
                    throw new Error('用户取消操作，无法继续');
                }
            }
            // 情况4：公钥和私钥都存在，正常读取
            const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
            Logger_1.default.debug(`成功读取本地 RSA 公钥: id_rsa.pub`);
            return publicKey;
        }
        catch (error) {
            Logger_1.default.error('读取 RSA 公钥失败', error);
            throw error;
        }
    }
    /**
     * 生成 RSA SSH 密钥对
     * 生成 id_rsa（私钥）和 id_rsa.pub（公钥）
     */
    static generateSSHKeyPair(sshDir) {
        try {
            const { execSync } = require('child_process');
            const keyPath = path.join(sshDir, 'id_rsa');
            Logger_1.default.info(`生成 RSA SSH 密钥对: ${keyPath}`);
            // 使用 ssh-keygen 生成 RSA 密钥对
            // -t rsa: 明确指定使用 RSA 算法
            // -b 2048: 密钥长度 2048 位
            // -f: 指定密钥文件路径（id_rsa）
            // -N "": 不设置密码
            // -C: 添加注释
            const command = `ssh-keygen -t rsa -b 2048 -f "${keyPath}" -N "" -C "hidevlab-vscode-plugin"`;
            execSync(command, {
                stdio: 'pipe',
                windowsHide: true
            });
            Logger_1.default.info('RSA SSH 密钥对生成成功 (id_rsa, id_rsa.pub)');
        }
        catch (error) {
            Logger_1.default.error('生成 RSA SSH 密钥对失败', error);
            throw new Error('生成 RSA SSH 密钥对失败，请手动执行: ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa -N ""');
        }
    }
    /**
     * 开机 HidevLab 环境（connect 接口）
     * @param devEnvId 开发环境 ID
     * @returns 机器连接信息
     */
    static async connectToEnvironment(devEnvId) {
        try {
            Logger_1.default.debug(`开机环境(connect): ${devEnvId}`);
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                // 根据 devEnvId 选择不同的 Mock 数据
                let mockKey = 'connect';
                const envIdStr = String(devEnvId);
                if (envIdStr === '201670581370283001') {
                    mockKey = 'connect_env1';
                }
                else if (envIdStr === '201670581370283002') {
                    mockKey = 'connect_env2';
                }
                else {
                }
                const mockData = await this.getMockData(mockKey, 1500);
                // 检查业务状态码
                if (mockData.code !== 200) {
                    throw new Error(`开机失败: ${mockData.msg} (code: ${mockData.code})`);
                }
                const connectData = mockData.data;
                // 保留原始时间戳（毫秒），传递给 DeviceItem 进行实时计算
                const usableTimeStr = connectData.usableTime ? connectData.usableTime.toString() : undefined;
                const machineInfo = {
                    devEnvId: connectData.devEnvId,
                    devEnvName: connectData.devEnvName,
                    ip: connectData.ip,
                    port: parseInt(connectData.port, 10),
                    userName: connectData.userName,
                    status: connectData.status,
                    workingDir: connectData.workingDir,
                    description: connectData.description,
                    exceptionDesc: connectData.exceptionDesc,
                    usableTime: usableTimeStr,
                    accountType: connectData.accountType,
                    // 跳板机相关字段
                    useProxy: connectData.useProxy,
                    jumpName: connectData.jumpName,
                    jumpIp: connectData.jumpIp,
                    jumpPort: connectData.jumpPort,
                    targetIp: connectData.targetIp,
                    targetPort: connectData.targetPort
                };
                // 清除旧的 known_hosts 指纹
                await this.removeKnownHostFingerprint(machineInfo.ip, machineInfo.port);
                return machineInfo;
            }
            // 读取本地公钥（异步操作，可能需要用户确认）
            const sshPublicKey = await this.readLocalPublicKey();
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/connect';
            const requestBody = {
                devEnvId: devEnvId,
                sshPublicKey: sshPublicKey
            };
            // HTTP 客户端会自动添加 sessionId header
            const response = await httpClient.post(url, requestBody);
            if (response.data) {
                // 检查业务状态码
                if (response.data.code !== 200) {
                    throw new Error(`开机失败: ${response.data.msg} (code: ${response.data.code})`);
                }
                const connectData = response.data.data;
                const machineName = connectData.devEnvName || `HidevLab-${devEnvId}`;
                Logger_1.default.info(`环境开机成功: ${machineName} (${connectData.status}), accountType: ${connectData.accountType}`);
                // 保留原始时间戳（毫秒），传递给 DeviceItem 进行实时计算
                const usableTimeStr = connectData.usableTime ? connectData.usableTime.toString() : undefined;
                const machineInfo = {
                    devEnvId: connectData.devEnvId,
                    devEnvName: connectData.devEnvName,
                    ip: connectData.ip,
                    port: parseInt(connectData.port, 10),
                    userName: connectData.userName,
                    status: connectData.status,
                    workingDir: connectData.workingDir,
                    description: connectData.description,
                    exceptionDesc: connectData.exceptionDesc,
                    usableTime: usableTimeStr,
                    accountType: connectData.accountType,
                    scrollBarValue: connectData.scrollBarValue,
                    // 跳板机相关字段
                    useProxy: connectData.useProxy,
                    jumpName: connectData.jumpName,
                    jumpIp: connectData.jumpIp,
                    jumpPort: connectData.jumpPort,
                    targetIp: connectData.targetIp,
                    targetPort: connectData.targetPort
                };
                // 清除旧的 known_hosts 指纹
                await this.removeKnownHostFingerprint(machineInfo.ip, machineInfo.port);
                return machineInfo;
            }
            else {
                throw new Error('开机响应数据为空');
            }
        }
        catch (error) {
            Logger_1.default.error(`开机环境失败: ${devEnvId}`, error);
            throw error;
        }
    }
    /**
     * 上传 SSH 公钥到已挂载的开发环境
     * @param devEnvId 开发环境 ID
     * @param sshPubkey SSH 公钥（可选，未提供时自动读取本地公钥）
     */
    static async uploadSshPubkey(devEnvId, sshPubkey) {
        try {
            Logger_1.default.debug(`上传 SSH 公钥到环境: ${devEnvId}`);
            if (this.isDebugMode()) {
                return await this.getMockData('upload_ssh_pubkey_success', 500);
            }
            const publicKey = sshPubkey ?? await this.readLocalPublicKey();
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/uploadSshPubkey';
            const requestBody = {
                devEnvId,
                sshPubkey: publicKey
            };
            const response = await httpClient.post(url, requestBody);
            if (response.data) {
                if (response.data.code !== 200) {
                    throw new Error(`上传公钥失败: ${response.data.msg} (code: ${response.data.code})`);
                }
                Logger_1.default.debug(`SSH 公钥上传成功: ${devEnvId}`);
                return response.data;
            }
            else {
                throw new Error('上传公钥响应数据为空');
            }
        }
        catch (error) {
            Logger_1.default.error(`上传 SSH 公钥失败: ${devEnvId}`, error);
            throw error;
        }
    }
    /**
     * 为多个已挂载环境批量上传 SSH 公钥（只读取一次本地公钥）
     * @param devEnvIds 开发环境 ID 列表
     */
    static async uploadSshPubkeyForEnvironments(devEnvIds) {
        if (devEnvIds.length === 0) {
            return;
        }
        const sshPubkey = await this.readLocalPublicKey();
        for (const devEnvId of devEnvIds) {
            try {
                await this.uploadSshPubkey(devEnvId, sshPubkey);
            }
            catch (error) {
                Logger_1.default.error(`为环境 ${devEnvId} 上传 SSH 公钥失败，继续处理其他环境`, error);
            }
        }
    }
    /**
     * 检查环境状态
     * @param devEnvId 开发环境 ID
     * @returns 机器状态信息
     */
    static async checkEnvironmentStatus(devEnvId) {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                // 根据调用次数返回不同的状态
                const statusKeys = ['status_connecting_1', 'status_connecting_2', 'status_running'];
                const key = statusKeys[Math.min(this.statusCheckCount, statusKeys.length - 1)];
                this.statusCheckCount++;
                const mockData = await this.getMockData(key, 800);
                // 检查业务状态码
                if (mockData.code !== 200) {
                    throw new Error(`状态检查失败: ${mockData.msg} (code: ${mockData.code})`);
                }
                return mockData.data;
            }
            const httpClient = this.getHttpClient();
            const url = `/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/checkStatus/${devEnvId}`;
            // HTTP 客户端会自动添加 sessionId header
            const response = await httpClient.get(url);
            if (response.data) {
                // 检查业务状态码
                if (response.data.code !== 200) {
                    // 平台已删除：msg 可能是「环境不存在」或「开发环境不存在」等
                    if (this.isEnvironmentNotFoundError(response.data.code, response.data.msg)) {
                        const error = new Error('ENVIRONMENT_NOT_FOUND');
                        error.code = 'ENVIRONMENT_NOT_FOUND';
                        error.devEnvId = devEnvId;
                        Logger_1.default.warning(`环境不存在: ${devEnvId}，需要从本地删除`);
                        throw error;
                    }
                    throw new Error(`状态检查失败: ${response.data.msg} (code: ${response.data.code})`);
                }
                const statusData = response.data.data;
                return statusData;
            }
            else {
                throw new Error('状态检查响应数据为空');
            }
        }
        catch (error) {
            // 业务已知错误已在上方记录，避免再打一条 ERROR
            if (error?.code !== 'ENVIRONMENT_NOT_FOUND') {
                Logger_1.default.error(`检查环境状态失败: ${devEnvId}`, error);
            }
            throw error;
        }
    }
    /**
     * 判断接口是否表示环境已在平台删除/不存在
     */
    static isEnvironmentNotFoundError(_code, msg) {
        const message = msg || '';
        // 覆盖「环境不存在」「开发环境不存在」等平台文案
        return message.includes('环境不存在');
    }
    /**
     * 判断错误对象是否为环境不存在
     */
    static isEnvironmentNotFound(error) {
        if (!error) {
            return false;
        }
        if (error.code === 'ENVIRONMENT_NOT_FOUND') {
            return true;
        }
        const message = error.message || String(error);
        return message.includes('ENVIRONMENT_NOT_FOUND') || message.includes('环境不存在');
    }
    /**
     * 轮询检查环境状态，直到状态变为 running 或 exception
     * @param devEnvId 开发环境 ID
     * @param onStatusChange 状态变化回调
     * @param maxAttempts 最大尝试次数（默认 60 次）
     * @param intervalMs 轮询间隔（默认 5 秒）
     * @param cancelFlag 取消标志，设置 cancel = true 可以停止轮询
     * @returns 最终状态
     */
    static async pollEnvironmentStatus(devEnvId, onStatusChange, maxAttempts = 60, intervalMs = 5000, cancelFlag) {
        Logger_1.default.debug(`开始轮询环境状态: ${devEnvId}`);
        let attempts = 0;
        let lastStatus = '';
        while (attempts < maxAttempts) {
            // 检查是否需要取消轮询
            if (cancelFlag && cancelFlag.cancel) {
                Logger_1.default.info(`轮询已被取消: ${devEnvId}`);
                throw new Error('轮询已被用户取消');
            }
            attempts++;
            try {
                const statusResponse = await this.checkEnvironmentStatus(devEnvId);
                const status = statusResponse.status;
                // 配额超限：停止轮询
                if (statusResponse.isOverLimitTime === true) {
                    const error = new Error('OVER_LIMIT_TIME');
                    error.code = 'OVER_LIMIT_TIME';
                    error.message = '您的免费配额已用完，感谢使用！社区贡献兑换功能即将上线，敬请期待！';
                    throw error;
                }
                // waitFlag：资源排队中，继续轮询等待
                if (statusResponse.waitFlag === true) {
                    if (status !== lastStatus) {
                        Logger_1.default.info(`环境 ${devEnvId} 资源排队中 (waitFlag=true), 状态: ${status}`);
                        lastStatus = status;
                    }
                    if (onStatusChange) {
                        onStatusChange(status, statusResponse);
                    }
                    await new Promise(resolve => setTimeout(resolve, intervalMs));
                    continue;
                }
                if (status !== lastStatus) {
                    Logger_1.default.debug(`环境 ${devEnvId} 状态: ${status}`);
                    lastStatus = status;
                }
                // 触发状态变化回调
                if (onStatusChange) {
                    onStatusChange(status, statusResponse);
                }
                // 终态：运行中 / 异常 / 已停止
                if (status === 'running' ||
                    status === 'exception' ||
                    status === 'start_exception' ||
                    status === 'stop_exception' ||
                    status === 'stopped' ||
                    status === 'ready' ||
                    status === 'disconnect') {
                    Logger_1.default.info(`环境状态已确定: ${status}`);
                    return statusResponse;
                }
                // 等待一段时间后继续轮询
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
            catch (error) {
                // 配额超限、环境已删除等业务错误直接抛出，不再重试
                if (error?.code === 'OVER_LIMIT_TIME' || this.isEnvironmentNotFound(error)) {
                    throw error;
                }
                Logger_1.default.debug(`轮询状态失败（第 ${attempts} 次），将重试`, error);
                // 如果是最后一次尝试，抛出错误
                if (attempts >= maxAttempts) {
                    throw new Error(`轮询超时：已尝试 ${maxAttempts} 次，环境状态仍未确定`);
                }
                // 否则继续尝试
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
        throw new Error(`轮询超时：已尝试 ${maxAttempts} 次，环境状态仍未确定`);
    }
    /**
     * 将 HidevLab 状态映射到设备状态
     * @param hidevLabStatus HidevLab 状态
     * @returns 设备状态
     */
    static mapStatusToDeviceStatus(hidevLabStatus) {
        switch (hidevLabStatus) {
            case 'running':
                return 'running';
            case 'exception':
            case 'start_exception':
            case 'stop_exception':
                return 'dead';
            case 'starting':
            case 'connecting':
                return 'connecting';
            case 'stopping':
            case 'disconnecting':
                return 'connecting';
            case 'stopped':
            case 'ready':
            case 'disconnect':
                return 'active';
            default:
                return 'dead';
        }
    }
    /**
     * 开机 HidevLab 环境（通过 connect 接口实现）
     * @param devEnvId 开发环境 ID
     * @returns 操作结果，data 字段包含机器信息用于刷新节点
     */
    static async startEnvironment(devEnvId) {
        try {
            Logger_1.default.debug(`开机环境(start): ${devEnvId}`);
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                const mockData = await this.getMockData('connect', 1500);
                // 保留原始时间戳（毫秒），传递给 DeviceItem 进行实时计算
                const usableTimeStr = mockData.data.usableTime ? mockData.data.usableTime.toString() : undefined;
                const machineInfo = {
                    devEnvId: mockData.data.devEnvId,
                    devEnvName: mockData.data.devEnvName,
                    ip: mockData.data.ip,
                    port: parseInt(mockData.data.port, 10),
                    userName: mockData.data.userName,
                    status: mockData.data.status,
                    workingDir: mockData.data.workingDir,
                    description: mockData.data.description,
                    exceptionDesc: mockData.data.exceptionDesc,
                    usableTime: usableTimeStr,
                    accountType: mockData.data.accountType,
                    // 跳板机相关字段
                    useProxy: mockData.data.useProxy,
                    jumpName: mockData.data.jumpName,
                    jumpIp: mockData.data.jumpIp,
                    jumpPort: mockData.data.jumpPort,
                    targetIp: mockData.data.targetIp,
                    targetPort: mockData.data.targetPort
                };
                return {
                    code: 200,
                    msg: '开机成功',
                    data: true,
                    machineInfo: machineInfo
                };
            }
            // connect 接口就相当于开机，直接调用 connectToEnvironment
            const machineInfo = await this.connectToEnvironment(devEnvId);
            // 返回统一的操作结果格式，包含机器信息用于刷新节点
            return {
                code: 200,
                msg: '开机成功',
                data: true,
                machineInfo: machineInfo
            };
        }
        catch (error) {
            // connectToEnvironment 已记录错误，这里只组装失败结果，避免重复 ERROR
            let errorMsg = '开机失败';
            if (error instanceof Error) {
                errorMsg = error.message;
            }
            else if (error !== null && error !== undefined) {
                try {
                    errorMsg = String(error);
                }
                catch {
                    errorMsg = '开机失败：未知错误';
                }
            }
            // 返回失败结果
            return {
                code: 500,
                msg: errorMsg,
                data: false
            };
        }
    }
    /**
     * 关机 HidevLab 环境
     * @param devEnvId 开发环境 ID
     * @returns 操作结果
     */
    static async stopEnvironment(devEnvId) {
        try {
            Logger_1.default.debug(`关机环境: ${devEnvId}`);
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return await this.getMockData('stop_success', 1000);
            }
            const httpClient = this.getHttpClient();
            const url = `/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/stop/${devEnvId}`;
            const response = await httpClient.post(url, {});
            if (response.data) {
                Logger_1.default.debug(`环境关机${response.data.data ? '成功' : '失败'}: ${response.data.msg}`);
                return response.data;
            }
            else {
                throw new Error('关机响应数据为空');
            }
        }
        catch (error) {
            Logger_1.default.error(`关机环境失败: ${devEnvId}`, error);
            throw error;
        }
    }
    /**
     * 获取 HidevLab refreshToken
     * 注意：此接口需要在 header 中带上 sessionId（即 authTicket/accessToken）
     * @returns refreshToken
     */
    static async getRefreshToken() {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                const mockData = await this.getMockData('get_refresh_token', 500);
                return mockData.data;
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/hwaccount/refreshToken';
            // 此接口会自动从 AuthService 获取 sessionId 并添加到 header
            const response = await httpClient.get(url);
            if (response.data && response.data.data) {
                return response.data.data;
            }
            else {
                throw new Error('refreshToken 响应数据为空');
            }
        }
        catch (error) {
            Logger_1.default.error('获取 refreshToken 失败', error);
            throw error;
        }
    }
    /**
     * 使用 refreshToken 刷新 accessToken
     * @param refreshToken - refresh token
     * @returns 新的 sessionId（从 response header 中获取）
     */
    static async refreshAccessToken(refreshToken) {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                await this.getMockData('refresh_access_token', 500);
                return 'mock-session-id-' + Date.now();
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/hwaccount/accessToken';
            // 使用 Cookie 格式传递 refreshToken
            const response = await httpClient.get(url, {
                headers: {
                    'Cookie': `sessionId=${refreshToken}`
                }
            });
            // 从 response header 的 set-cookie 中提取 sessionId
            const setCookieHeader = response.headers['set-cookie'];
            let newSessionId = null;
            if (setCookieHeader) {
                // set-cookie 可能是数组或字符串
                const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
                // 遍历所有 cookie，找到 sessionId
                for (const cookie of cookies) {
                    const match = cookie.match(/sessionId=([^;]+)/);
                    if (match && match[1]) {
                        newSessionId = match[1];
                        break;
                    }
                }
            }
            if (newSessionId) {
                return newSessionId;
            }
            else {
                throw new Error('响应 header 中未找到 sessionId');
            }
        }
        catch (error) {
            Logger_1.default.error('刷新 accessToken 失败', error);
            throw error;
        }
    }
    /**
     * 获取 HidevLab 环境状态（用于关机/删除后的状态检查）
     * @param devEnvId 开发环境 ID
     * @returns 状态信息，v2: starting/start_exception/running/stopping/stopped/stop_exception/exception
     */
    static async getStatus(devEnvId) {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                const mockStatuses = ['stopping', 'stopped', 'start_exception', 'stop_exception'];
                const randomStatus = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];
                return {
                    code: 200,
                    msg: "成功",
                    data: randomStatus
                };
            }
            const httpClient = this.getHttpClient();
            const url = `/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/getStatus/${devEnvId}`;
            // HTTP 客户端会自动添加 sessionId header
            const response = await httpClient.get(url);
            if (response.data) {
                return response.data;
            }
            else {
                throw new Error('获取状态响应数据为空');
            }
        }
        catch (error) {
            Logger_1.default.error(`获取环境状态失败: ${devEnvId}`, error);
            throw error;
        }
    }
    /**
     * 轮询检查环境状态，直到达到目标状态
     * @param devEnvId 开发环境 ID
     * @param targetStatuses 目标状态数组，如 ['stopped']
     * @param maxAttempts 最大轮询次数，默认 30 次
     * @param intervalMs 轮询间隔，默认 2000ms
     * @returns 最终状态
     */
    static async pollStatusUntilTarget(devEnvId, targetStatuses, maxAttempts = 30, intervalMs = 2000) {
        Logger_1.default.debug(`开始轮询环境状态: ${devEnvId}, 目标: ${targetStatuses.join(', ')}`);
        let stoppingCount = 0; // 连续 stopping/disconnecting 状态计数
        const maxStoppingAttempts = 15; // 最多允许 15 次中间态（约30秒），之后视为已停止
        let lastStatus = '';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const statusResponse = await this.getStatus(devEnvId);
                if (statusResponse.code === 200) {
                    const currentStatus = statusResponse.data;
                    if (currentStatus !== lastStatus) {
                        Logger_1.default.debug(`环境 ${devEnvId} 状态: ${currentStatus}`);
                        lastStatus = currentStatus;
                    }
                    // 检查是否达到目标状态
                    if (targetStatuses.includes(currentStatus)) {
                        Logger_1.default.info(`状态轮询完成: ${currentStatus}`);
                        return currentStatus;
                    }
                    // 中间态累计计数，超时后按已停止处理
                    if (currentStatus === 'stopping' || currentStatus === 'disconnecting') {
                        stoppingCount++;
                        if (stoppingCount >= maxStoppingAttempts) {
                            Logger_1.default.warning(`连续 ${stoppingCount} 次处于 ${currentStatus} 状态，视为已停止`);
                            return targetStatuses.includes('stopped') ? 'stopped' : (targetStatuses[0] || 'stopped');
                        }
                    }
                    else {
                        stoppingCount = 0;
                    }
                }
                else {
                    Logger_1.default.warning(`状态检查失败: ${statusResponse.msg}`);
                }
                // 如果不是最后一次尝试，等待后继续
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, intervalMs));
                }
            }
            catch (error) {
                Logger_1.default.warning(`轮询第 ${attempt} 次失败，将重试`, error);
                // 如果不是最后一次尝试，等待后继续
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, intervalMs));
                }
            }
        }
        throw new Error(`状态轮询超时，未能在 ${maxAttempts} 次尝试内达到目标状态: ${targetStatuses.join(', ')}`);
    }
    /**
     * 删除 HidevLab 环境
     * @param devEnvId 开发环境 ID
     * @returns 操作结果
     */
    static async deleteEnvironment(devEnvId) {
        try {
            Logger_1.default.debug(`删除环境: ${devEnvId}`);
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return await this.getMockData('delete_success', 1000);
            }
            const httpClient = this.getHttpClient();
            const url = `/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/delete/${devEnvId}`;
            const response = await httpClient.delete(url);
            if (response.data) {
                Logger_1.default.debug(`环境删除${response.data.data ? '成功' : '失败'}: ${response.data.msg}`);
                return response.data;
            }
            else {
                throw new Error('删除响应数据为空');
            }
        }
        catch (error) {
            Logger_1.default.error(`删除环境失败: ${devEnvId}`, error);
            throw error;
        }
    }
    /**
     * 删除 known_hosts 中指定主机的指纹
     * @param host 主机地址
     * @param port 端口号
     */
    static async removeKnownHostFingerprint(host, port) {
        try {
            const homedir = os.homedir();
            const knownHostsPath = path.join(homedir, '.ssh', 'known_hosts');
            if (!fs.existsSync(knownHostsPath)) {
                Logger_1.default.debug(`已知_hosts 文件不存在，无需删除: ${knownHostsPath}`);
                return;
            }
            // 读取 known_hosts 文件
            const content = fs.readFileSync(knownHostsPath, 'utf-8');
            const lines = content.split('\n');
            // 过滤掉匹配的行
            const hostPattern = `[${host}]:${port}`;
            const filteredLines = lines.filter((line) => {
                if (!line.trim()) {
                    return true; // 保留空行
                }
                // 删除包含目标主机:端口的行
                return !line.includes(hostPattern) && !line.startsWith(`${host} `);
            });
            // 写回文件
            fs.writeFileSync(knownHostsPath, filteredLines.join('\n'), 'utf-8');
            Logger_1.default.debug(`已清除 ${host}:${port} 的 known_hosts 指纹`);
        }
        catch (error) {
            Logger_1.default.error(`删除 known_hosts 指纹失败: ${host}:${port}`, error);
            // 不抛出错误，避免影响主流程
        }
    }
    /**
     * 将接口返回的权限字段规范为布尔值（兼容 true/"true"/1）
     */
    static normalizePermissionFlag(value) {
        return value === true
            || value === 1
            || value === '1'
            || value === 'true';
    }
    /**
     * 检查用户是否有权限创建开发环境
     * @returns true 表示有权限，false 表示没有权限
     */
    static async checkCreatePermission() {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return true;
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/hasPermission';
            const response = await httpClient.get(url);
            if (response.data && response.data.code === 200) {
                const hasPermission = this.normalizePermissionFlag(response.data.data);
                Logger_1.default.info(`创建环境权限检查: ${hasPermission}`);
                return hasPermission;
            }
            else {
                Logger_1.default.warning('权限检查响应异常', response.data);
                return false;
            }
        }
        catch (error) {
            Logger_1.default.error('检查创建环境权限失败', error);
            return false;
        }
    }
    /**
     * 获取创建开发环境申请页面默认配置数据
     * @returns 默认配置数据
     */
    static async loadDefaultData() {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return {
                    code: 200,
                    msg: 'success',
                    data: {
                        devEnvName: `DevEnv_${Math.floor(Math.random() * 1000000)}`,
                        computeTypeList: [
                            { label: '昇腾算力', value: '2' }
                        ],
                        maxEnvItems: 5,
                        storeSizeList: [
                            { label: '300G', value: '300G' }
                        ]
                    }
                };
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/loadDefaultData';
            const response = await httpClient.get(url);
            if (response.data) {
                return response.data;
            }
            else {
                throw new Error('默认配置数据响应为空');
            }
        }
        catch (error) {
            Logger_1.default.error('获取默认配置数据失败', error);
            throw error;
        }
    }
    /**
     * 获取算力类型列表
     * @returns 算力类型列表及默认值
     */
    static async listDeviceType() {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return {
                    code: 200,
                    msg: '成功',
                    data: {
                        devices: [
                            { deviceNo: '910B3', deviceName: '昇腾910B3', hasPermission: 'true' },
                            { deviceNo: '910B4', deviceName: '昇腾910B4', hasPermission: 'true' },
                            { deviceNo: '910C', deviceName: '昇腾910C', hasPermission: 'true' },
                            { deviceNo: '950PR', deviceName: '昇腾950PR', hasPermission: 'false' },
                            { deviceNo: 'A2', deviceName: 'A2', hasPermission: 'false' }
                        ],
                        defaultDevice: '910C'
                    }
                };
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/listDeviceType';
            const response = await httpClient.get(url);
            if (response.data) {
                return response.data;
            }
            else {
                throw new Error('算力类型列表响应为空');
            }
        }
        catch (error) {
            Logger_1.default.error('获取算力类型列表失败', error);
            throw error;
        }
    }
    /**
     * 列出 localIde 开发环境规格
     * @param imageId 镜像 ID
     * @param computeType 算力平台，昇腾为 2
     * @returns 规格列表
     */
    static async listFlavor(computeType = 2, imageId, modelType) {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return {
                    code: 200,
                    msg: '成功',
                    data: [
                        { label: '1*NPU 910B4 32vCPUs 32GiB', value: '2016713617585618944', npu: 1, memory: 32, usage: '算子调测/小模型训推', cpu: 32, storage: 300 },
                        { label: '4*NPU 910B3 32vCPUs 32GiB', value: '2016713617585618946', npu: 4, memory: 32, usage: '大模型训练', cpu: 32, storage: 500 },
                        { label: '1*NPU 910C 32vCPUs 120GiB', value: '2027341822508072960', npu: 1, memory: 240, usage: '算子调测/小模型训推', cpu: 40, storage: 300 }
                    ]
                };
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/listFlavor';
            const params = { computeType };
            if (imageId !== undefined) {
                params.imageId = imageId;
            }
            if (modelType) {
                params.modelType = modelType;
            }
            const response = await httpClient.get(url, { params });
            if (response.data) {
                return response.data;
            }
            else {
                throw new Error('规格列表响应为空');
            }
        }
        catch (error) {
            Logger_1.default.error('获取规格列表失败', error);
            throw error;
        }
    }
    /**
     * 列出镜像
     * @param modelType 算力类型，如 910B3/910B4/910C/950PR
     * @returns 镜像列表
     */
    static async listImage(modelType) {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                return {
                    code: 200,
                    msg: '成功',
                    data: {
                        result: [
                            {
                                id: 3,
                                name: 'cann8.5.1',
                                version: '8.5.1',
                                description: 'CANN 8.5.1 是华为昇腾计算架构的基础镜像，支持 MindSpore、PyTorch 等主流深度学习框架，内置 NPU 驱动和算子库，适用于 910 系列设备的模型训练与推理场景，提供完整的开发工具链和性能调优能力',
                                category: 'BASE',
                                categoryName: '基础镜像',
                                project: 'CANN',
                                projectName: 'CANN',
                                issueUrl: 'https://github.com',
                                specNote: '推荐910设备，内置 CANN 8.5.RC1、Python 3.11、PyTorch 2.9.0、torch_npu 2.9.0、vllm_ascend 0.17.0rc1',
                                addressList: [
                                    { deviceGen: '950', address: 'test', localName: 'cann8.5.1-py3.11-torch2.9.0-torch_npu2.9.0-vllm_ascend0.17.0rc1-310p' },
                                    { deviceGen: '910B', address: 'test2', localName: 'cann8.5.1-py3.11-torch2.9.0-torch_npu2.9.0-vllm_ascend0.17.0rc1' }
                                ]
                            },
                            {
                                id: 4,
                                name: 'cann8.0.0',
                                version: '8.0.0',
                                description: 'CANN 8.0.0 昇腾计算架构基础镜像，适用于 Ascend 910/910B 系列设备，提供稳定的算子支持和模型迁移能力',
                                category: 'BASE',
                                categoryName: '基础镜像',
                                project: 'CANN',
                                projectName: 'CANN',
                                issueUrl: 'https://github.com',
                                specNote: '内置 CANN 8.0.0、Python 3.9、PyTorch 2.1.0',
                                addressList: [
                                    { deviceGen: '910', address: 'cann8-addr', localName: 'cann8.0.0-py3.9-torch2.1.0' }
                                ]
                            },
                            {
                                id: 14,
                                name: 'MindFormers',
                                version: '1.26.3.0',
                                description: 'MindFormers 大模型训练套件组件镜像，支持 LLaMA、GPT、Bloom 等主流大模型架构，提供分布式训练、微调、推理一体化解决方案',
                                category: 'COMPONENT',
                                categoryName: '组件镜像',
                                project: 'MindFormers',
                                projectName: 'MindFormers',
                                issueUrl: 'https://github.com/mindspore-lab/mindformers/issues',
                                specNote: 'MindFormers 大模型训练套件，支持 LLaMA/GPT/Bloom 等架构',
                                addressList: [
                                    { deviceGen: '910B', address: 'ffff', localName: null }
                                ]
                            },
                            {
                                id: 25,
                                name: 'MindSpore',
                                version: '2.6.0',
                                description: 'MindSpore 昇腾全场景深度学习框架组件镜像，支持自动微分、自动并行等特性，适用于大模型预训练、微调及推理部署，兼容 Ascend 910B/910P 系列硬件平台',
                                category: 'COMPONENT',
                                categoryName: '组件镜像',
                                project: 'MindSpore',
                                projectName: 'MindSpore',
                                issueUrl: 'https://gitee.com/mindspore/mindspore/issues',
                                specNote: 'MindSpore 2.6.0、CANN 8.5.RC1、Python 3.11',
                                addressList: [
                                    { deviceGen: '910B', address: 'mindspore-addr', localName: 'mindspore2.6.0-cann8.5' }
                                ]
                            },
                            {
                                id: 31,
                                name: 'vLLM-Ascend',
                                version: '0.17.0',
                                description: 'vLLM Ascend 推理加速组件镜像，基于 vLLM 框架适配昇腾 NPU，提供高性能大模型推理服务，支持 PagedAttention、连续批处理等优化技术',
                                category: 'COMPONENT',
                                categoryName: '组件镜像',
                                project: 'vLLM',
                                projectName: 'vLLM',
                                issueUrl: 'https://github.com/vllm-project/vllm/issues',
                                specNote: 'vLLM 0.17.0rc1、CANN 8.5.RC1、torch_npu 2.9.0',
                                addressList: [
                                    { deviceGen: '910B', address: 'vllm-addr', localName: 'vllm0.17-cann8.5' }
                                ]
                            },
                            {
                                id: 42,
                                name: 'torch_npu',
                                version: '2.9.0',
                                description: 'PyTorch NPU 扩展组件镜像，为 PyTorch 提供昇腾 NPU 后端支持，实现 PyTorch 原生 API 在 NPU 上的高效运行，支持混合精度训练和梯度累积',
                                category: 'COMPONENT',
                                categoryName: '组件镜像',
                                project: 'PyTorch',
                                projectName: 'PyTorch',
                                issueUrl: 'https://github.com/Ascend/pytorch/issues',
                                specNote: 'torch_npu 2.9.0、CANN 8.5.RC1、Python 3.11',
                                addressList: [
                                    { deviceGen: '910B', address: 'torchnpu-addr', localName: 'torch_npu2.9.0-cann8.5' }
                                ]
                            },
                            {
                                id: 55,
                                name: 'MindStudio',
                                version: '7.0.0',
                                description: 'MindStudio 昇腾开发环境组件镜像，集成算子开发、模型调优、性能分析等工具，支持自定义算子开发和全流程性能优化',
                                category: 'COMPONENT',
                                categoryName: '组件镜像',
                                project: 'MindStudio',
                                projectName: 'MindStudio',
                                issueUrl: 'https://www.hiascend.com/document',
                                specNote: 'MindStudio 7.0.0、CANN 8.5.RC1、msprof 性能分析工具',
                                addressList: [
                                    { deviceGen: '910B', address: 'studio-addr', localName: 'mindstudio7.0-cann8.5' }
                                ]
                            }
                        ],
                        project: [
                            { label: 'CANN', value: 'CANN' },
                            { label: 'MindFormers', value: 'MindFormers' },
                            { label: 'MindSpore', value: 'MindSpore' },
                            { label: 'vLLM', value: 'vLLM' },
                            { label: 'PyTorch', value: 'PyTorch' },
                            { label: 'MindStudio', value: 'MindStudio' }
                        ],
                        category: [
                            { label: '基础镜像', value: 'BASE' },
                            { label: '组件镜像', value: 'COMPONENT' }
                        ]
                    }
                };
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/listImage';
            const params = {};
            if (modelType) {
                params.modelType = modelType;
            }
            const response = await httpClient.get(url, { params });
            if (response.data) {
                return response.data;
            }
            else {
                throw new Error('镜像列表响应为空');
            }
        }
        catch (error) {
            Logger_1.default.error('获取镜像列表失败', error);
            throw error;
        }
    }
    /**
     * 校验自定义镜像地址
     * @param url 自定义镜像地址
     * @returns 校验结果，data 为 null 表示合法，有内容则表示错误信息
     */
    static async validateCustomImageUrl(url) {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                await new Promise(resolve => setTimeout(resolve, 500));
                // 模拟：包含 "error" 的 URL 返回错误，其他返回成功
                if (url.includes('error') || url.includes('invalid')) {
                    return { code: 200, msg: '成功', data: '自定义镜像地址错误' };
                }
                return { code: 200, msg: '操作成功', data: null };
            }
            const httpClient = this.getHttpClient();
            const apiUrl = `/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/validateCustomImageUrl?url=${encodeURIComponent(url)}`;
            const response = await httpClient.get(apiUrl);
            if (response.data) {
                return response.data;
            }
            else {
                throw new Error('校验镜像地址响应为空');
            }
        }
        catch (error) {
            Logger_1.default.error('校验自定义镜像地址失败', error);
            throw error;
        }
    }
    /**
     * 规范化 storeSize：接口要求纯数字，如 "300"
     */
    static normalizeStoreSize(storeSize) {
        if (!storeSize) {
            return '';
        }
        const matched = String(storeSize).match(/\d+/);
        return matched ? matched[0] : String(storeSize);
    }
    /**
     * 通过本地 IDE 批量创建开发环境（v2）
     * @param items 环境配置列表
     * @returns 创建结果（data 为环境数组）
     */
    static async createDevEnv(items) {
        try {
            const request = Array.isArray(items)
                ? (() => {
                    const ideDevs = items.map(item => ({
                        devEnvName: item.devEnvName,
                        flavor: item.flavor,
                        image: item.image || '',
                        customImageUrl: item.customImageUrl || '',
                        computeType: Number(item.computeType) || 2,
                        storeSize: this.normalizeStoreSize(item.storeSize),
                        modelType: item.modelType || ''
                    }));
                    return {
                        // 外层 computeType 与第一条 ideDev 保持一致
                        computeType: Number(ideDevs[0]?.computeType) || 2,
                        envType: 'multiple',
                        ideDevs
                    };
                })()
                : items;
            Logger_1.default.debug('批量创建开发环境', request);
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return {
                    code: 200,
                    msg: '成功',
                    data: (request.ideDevs || []).map((item, index) => ({
                        id: `203415419794441830${index + 1}`,
                        devEnvName: item.devEnvName,
                        status: 'stopped',
                        usableTime: 73.83,
                        workingDir: '/workspace/user_data',
                        accountType: 'external',
                        description: 'Mock 创建环境'
                    }))
                };
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/createDevEnv';
            const response = await httpClient.post(url, request);
            if (response.data) {
                if (response.data.code !== 200) {
                    throw new Error(`创建环境失败: ${response.data.msg} (code: ${response.data.code})`);
                }
                const createdList = response.data.data || [];
                Logger_1.default.debug(`开发环境创建成功，共 ${createdList.length} 个`);
                return response.data;
            }
            else {
                throw new Error('创建环境响应为空');
            }
        }
        catch (error) {
            Logger_1.default.error('创建开发环境失败', error);
            throw error;
        }
    }
    /**
     * 获取创建页配置（如单次最多申请环境数）
     * @returns 最大环境数，失败时返回默认值 4
     */
    static async getMaxEnvItems() {
        const defaultMaxEnvItems = 4;
        try {
            if (this.isDebugMode()) {
                return defaultMaxEnvItems;
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/configuration';
            const response = await httpClient.get(url);
            const maxEnvItems = response.data?.data?.maxEnvItems;
            if (response.data?.code === 200 && typeof maxEnvItems === 'number' && maxEnvItems > 0) {
                return maxEnvItems;
            }
            Logger_1.default.warning(`获取 maxEnvItems 失败，使用默认值 ${defaultMaxEnvItems}`);
            return defaultMaxEnvItems;
        }
        catch (error) {
            Logger_1.default.error('获取 maxEnvItems 失败，使用默认值 4', error);
            return defaultMaxEnvItems;
        }
    }
    /**
     * 获取环境列表
     * @returns 环境列表
     */
    static async listDevEnv() {
        try {
            // 检查是否启用 Debug 模式
            if (this.isDebugMode()) {
                // 返回 Mock 数据
                return [
                    {
                        id: '130785',
                        devEnvName: 'DevEnv_260090',
                        devEnvDesc: '测试环境1',
                        status: 'running',
                        workingDir: '/workspace/user_data',
                        createTime: new Date().toISOString(),
                        scrollBarValue: 100
                    },
                    {
                        id: '130786',
                        devEnvName: 'DevEnv_260091',
                        devEnvDesc: '测试环境2',
                        status: 'starting',
                        workingDir: '/workspace/user_data',
                        createTime: new Date().toISOString(),
                        scrollBarValue: 45
                    }
                ];
            }
            const httpClient = this.getHttpClient();
            const url = '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/listDevEnv';
            const response = await httpClient.get(url);
            if (response.data && response.data.code === 200) {
                return response.data.data || [];
            }
            else {
                throw new Error(response.data?.msg || '获取环境列表失败');
            }
        }
        catch (error) {
            Logger_1.default.error('获取环境列表失败', error);
            throw error;
        }
    }
}
exports.HidevLabApi = HidevLabApi;
HidevLabApi.httpClient = null;
HidevLabApi.statusCheckCount = 0; // Mock 模式下的状态检查计数器
HidevLabApi.mockData = null; // Mock 数据缓存
HidevLabApi.debugMode = null; // Debug 模式缓存
HidevLabApi.environment = null; // 环境配置缓存
//# sourceMappingURL=HidevLabApi.js.map