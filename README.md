# openlibing-rm-cli

一个面向 macOS 和 Linux 的 Node.js CLI，用命令行管理
[HidevLab](https://hidevlab.huawei.com/) 开发环境。项目复用了
`openlibing.ResourceManager@0.0.34` 的已编译 CommonJS 核心，并用本地 CLI
包装认证、环境管理、连接方案和同步方案。

## 特性

- 生产环境认证、凭据状态查询、清除和自动刷新
- 环境列表、详情、状态、创建、启动、停止和删除
- 默认值、设备类型、镜像和规格目录查询
- 仅生成 SSH、SFTP 或 rsync 方案，不执行连接或传输
- Tampermonkey 登录辅助脚本：从已登录网页复制一次性 CLI 凭据
- Marketplace VSIX 下载、SHA-256 校验、Zip Slip 防护和上游锁定

首版只支持生产环境、macOS 和 Linux；不支持 Windows、测试环境、自定义
端点、浏览器登录自动化、VS Code 会话导入或远程任务执行。

## 安装

要求 Node.js 20 或更新版本：

```sh
npm ci
npm run cli -- --help
```

通常不需要重新下载已提交的上游内核。需要重新同步时，显式指定版本：

```sh
npm run upstream:sync -- --version 0.0.34
npm run upstream:verify
```

## 登录

### 浏览器辅助登录（推荐）

1. 在 Tampermonkey 中安装脚本：
   [`hidevlab-copy-credentials.user.js`](https://raw.githubusercontent.com/KaranocaVe/openlibing-rm-cli/main/userscripts/hidevlab-copy-credentials.user.js)。
2. 打开已登录的 `https://hidevlab.huawei.com/` 页面。
3. 点击右下角的“复制 CLI 凭据”。脚本会从当前会话请求一次性
   `authTicket`，并将以下 JSON 放入剪贴板：

   ```json
   {"authTicket":"..."}
   ```

4. 在项目目录导入剪贴板内容：

   ```sh
   pbpaste | npm run cli -- auth set --stdin                 # macOS
   xclip -selection clipboard -o | npm run cli -- auth set --stdin  # Linux
   ```

网页脚本只调用 `getOneAccessToken`，不会在浏览器中调用刷新接口。CLI
随后在自己的 Node.js 进程中用 `authTicket` 换取 `refreshToken`，再原子写入
用户凭据文件。剪贴板内容属于敏感凭据，导入后请立即清除。

### 直接导入已有凭据

如果已经有上游格式的凭据，也可以通过标准输入导入；凭据绝不接受命令行
参数：

```sh
printf '%s' '{"token":"session-id","refreshToken":"refresh-token"}' \
  | npm run cli -- auth set --stdin
```

查看或清除本地凭据：

```sh
npm run cli -- auth status --json
npm run cli -- auth clear --yes
```

### 多账号

凭据文件可以保存多个命名账号。账号名只能包含字母、数字、点、下划线和
连字符，长度不超过 64 个字符。首次安装时，旧版单账号文件会自动按
`default` 账号读取，并在下一次写入时升级为多账号格式。

```sh
# 分别导入两个账号。导入 authTicket 的方式与上文相同
pbpaste | npm run cli -- auth set --stdin --account personal
pbpaste | npm run cli -- auth set --stdin --account work

# 查看账号列表和当前账号（只显示元数据，不显示凭据）
npm run cli -- auth list --json

# 切换默认账号，之后不带 --account 的命令使用它
npm run cli -- auth use work
npm run cli -- env list

# 单次操作显式选择账号，不改变当前账号
npm run cli -- env list --account personal --json
npm run cli -- auth status --account personal --json

# 删除一个账号；删除当前账号后会自动选择剩余账号
npm run cli -- auth clear work --yes

# 删除全部账号
npm run cli -- auth clear --all --yes
```

`auth set` 未指定 `--account` 时写入当前账号；尚未配置账号时使用
`default`。`auth use` 只改变本地当前账号指针，不会调用 HidevLab。

所有账号凭据存放在同一个用户级 JSON 文件中，不写入项目目录：

- macOS：`~/Library/Application Support/openlibing-rm/credentials.json`
- Linux：`$XDG_CONFIG_HOME/openlibing-rm/credentials.json`，未设置时使用
  `~/.config/openlibing-rm/credentials.json`

目录权限为 `0700`，文件权限为 `0600`，更新采用临时文件加原子重命名。

## 常用命令

所有查询和方案命令都支持 `--json`；输出会递归脱敏。

```sh
# 环境查询
npm run cli -- env list
npm run cli -- env show <environment-id>
npm run cli -- env status <environment-id>

# 创建和生命周期操作
npm run cli -- catalog defaults --json
npm run cli -- catalog device-types --json
npm run cli -- catalog images --model-type <model-type> --json
npm run cli -- catalog flavors --compute-type 2 --json
npm run cli -- env create --spec create.json --yes
npm run cli -- env start <environment-id> --yes
npm run cli -- env stop <environment-id> --yes
npm run cli -- env delete <environment-id> --yes

# 只生成方案，不执行 ssh、sftp 或 rsync
npm run cli -- env connection-plan <environment-id> --yes --json
npm run cli -- env sync-plan <environment-id> --local ./project --yes --json
npm run cli -- env sync-plan <environment-id> --local ./project \
  --transport rsync --yes --json

# 工作目录兜底配置
npm run cli -- config set default-working-dir /workspace/user
npm run cli -- config show --json
```

`env create` 的 `--spec` 使用上游 `createDevEnv` 请求体，至少包含
`computeType`、`envType: "multiple"` 和一个 `ideDevs` 项。所有会修改远端资源
或可能触发 `connect` 的命令，在交互终端中要求确认；自动化场景必须显式传
`--yes`。

连接方案会调用上游连接接口，因此 HidevLab 可能启动目标环境；本项目不会
执行方案中的命令，也不会把密码放入方案、JSON、日志或错误信息。远程工作
目录优先级为显式参数、环境返回的 `workingDir`、本地配置，三者都没有时失败。

## 上游内核同步

`vendor/openlibing-resource-manager/` 是从 Marketplace VSIX 中复制的最小运行
闭包，不依赖 VS Code 安装或上游 Git 仓库。`upstream.lock.json` 记录版本、VSIX
URL、压缩包大小和 SHA-256、复制文件哈希、许可证及来源。

```sh
npm run upstream:sync -- --version <version>
npm run upstream:sync -- --latest
npm run upstream:verify
```

同步失败不会覆盖现有内核。上游声明 MIT，来源和第三方说明见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 安全注意事项

- 凭据不进入命令行参数、项目文件、标准输出、错误输出或调试日志。
- 上游 HTTP 客户端会按原样将 `NODE_TLS_REJECT_UNAUTHORIZED=0` 设置为整个
  Node.js 进程的全局行为；这是为了保持与上游运行时一致。请不要在同一进程
  中混用不相关的网络操作。
- `authTicket` 是一次性浏览器会话凭据，不应粘贴到 Issue、聊天或 shell 历史
  中。

## 开发与验证

```sh
npm run build
npm test
npm run upstream:verify
npm run cli -- --help
```

测试使用 HTTP mock，不会创建、启动、停止或删除真实 HidevLab 资源；方案测试
也不会 spawn SSH、SFTP 或 rsync。
