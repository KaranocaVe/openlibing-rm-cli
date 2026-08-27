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
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = __importStar(require("vscode"));
/**
 * 统一日志：默认 INFO 保留关键业务节点；DEBUG 需打开 openlibing.enableDebugLog。
 * 相同文案在短窗口内去重，避免轮询/重试/双层 catch 刷屏。
 */
class Logger {
    static init() {
        this.outputChannel = vscode.window.createOutputChannel('openLiBing ResourceManage');
    }
    static formatArg(arg) {
        if (arg instanceof Error) {
            return arg.message || String(arg);
        }
        if (typeof arg === 'object' && arg !== null) {
            try {
                const anyArg = arg;
                if (typeof anyArg.message === 'string' && anyArg.message) {
                    return anyArg.message;
                }
                if (typeof anyArg.msg === 'string' && anyArg.msg) {
                    return anyArg.msg;
                }
                const json = JSON.stringify(arg);
                return json === '{}' ? String(arg) : json;
            }
            catch {
                return String(arg);
            }
        }
        return String(arg);
    }
    static shouldSkipDuplicate(level, fullMessage) {
        // ERROR / WARNING 也去重，但窗口更短外的重复仍输出；INFO/DEBUG 同样
        const now = Date.now();
        const key = `${level}|${fullMessage}`;
        if (key === this.lastMessageKey && now - this.lastMessageAt < this.DEDUPE_WINDOW_MS) {
            this.lastMessageRepeat++;
            return true;
        }
        // 若上一轮有被压制的重复，补一行汇总
        if (this.lastMessageRepeat > 0 && this.outputChannel) {
            const suppressed = this.lastMessageRepeat;
            this.lastMessageRepeat = 0;
            const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            this.outputChannel.appendLine(`[${ts}] [INFO] （上条相同日志已合并省略 ${suppressed} 次）`);
        }
        this.lastMessageKey = key;
        this.lastMessageAt = now;
        this.lastMessageRepeat = 0;
        return false;
    }
    static log(level, message, ...args) {
        if (!this.outputChannel) {
            this.init();
        }
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const formattedArgs = args.length > 0 ? ' ' + args.map(a => this.formatArg(a)).join(' ') : '';
        const body = `${message}${formattedArgs}`;
        if (this.shouldSkipDuplicate(level, body)) {
            return;
        }
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${body}`);
    }
    static info(message, ...args) {
        this.log('INFO', message, ...args);
    }
    static warning(message, ...args) {
        this.log('WARNING', message, ...args);
    }
    static error(message, ...args) {
        this.log('ERROR', message, ...args);
    }
    /**
     * 调试日志默认不输出。排查时打开设置 openlibing.enableDebugLog。
     */
    static debug(message, ...args) {
        try {
            const enabled = vscode.workspace.getConfiguration('openlibing').get('enableDebugLog', false);
            if (!enabled) {
                return;
            }
        }
        catch {
            return;
        }
        this.log('DEBUG', message, ...args);
    }
    static show() {
        if (this.outputChannel) {
            this.outputChannel.show();
        }
    }
    static dispose() {
        if (this.outputChannel) {
            this.outputChannel.dispose();
        }
    }
}
Logger.lastMessageKey = '';
Logger.lastMessageAt = 0;
Logger.lastMessageRepeat = 0;
/** 相同日志去重窗口（毫秒） */
Logger.DEDUPE_WINDOW_MS = 3000;
exports.default = Logger;
//# sourceMappingURL=Logger.js.map