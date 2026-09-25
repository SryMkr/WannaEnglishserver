# WannaEnglish 后端操作说明

这份文档用于日常维护 WannaEnglish 后端。后端是 Node.js 服务，主要负责用户数据、学习记录、匹配、好友房、自选词和排行榜等接口。

## 一、项目位置

本地后端目录：

```text
/Users/jianshuqiao/Applications/MiniGame/WannaEnglishserver
```

线上一般部署在宝塔的网站目录下。以下命令都需要先进入后端项目目录再执行。

## 二、第一次部署或换服务器

### 1. 准备环境

- Node.js LTS，建议 18 或 20
- MySQL 8
- npm

### 2. 安装依赖

```bash
cd /www/wwwroot/WannaEnglishserver
npm install
```

### 3. 配置环境变量

在项目根目录创建 .env。不要把真实密码、密钥提交到 Git 或发到群里。

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=forgeti
DB_USER=数据库用户名
DB_PASSWORD=数据库密码
```

如果项目使用到第三方服务，还需要按现有 .env 配置对应的服务密钥。

### 4. 初始化或更新数据库

数据库脚本位于：

```text
database/backend_feature_migration.sql
```

执行前先备份线上数据库，并确认影响范围。该脚本主要处理匹配、自选词、模式进入、教程状态等业务表，不应删除以下单词基础表：

```text
vocabulary
vocabulary_language_relation
prefix_code
root_code
suffix_code
language_level_code
```

执行方式：

```bash
mysql -u 数据库用户名 -p forgeti < database/backend_feature_migration.sql
```

输入数据库密码后等待执行完成，再确认服务可以正常启动。

## 三、日常启动和停止

### 本地启动

```bash
cd /Users/jianshuqiao/Applications/MiniGame/WannaEnglishserver
npm start
```

默认端口是 `3000`。看到下面类似日志表示服务已启动：

```text
Server running at http://0.0.0.0:3000
```

开发时需要修改代码后自动重启，可以使用：

```bash
npm run dev
```

### 线上启动

线上建议使用宝塔 Node 项目或 PM2 管理进程，不要依赖 SSH 窗口保持运行。

PM2 示例：

```bash
cd /www/wwwroot/WannaEnglishserver
pm2 start server.js --name wanna-english-server
pm2 save
```

常用操作：

```bash
pm2 status
pm2 logs wanna-english-server
pm2 restart wanna-english-server
pm2 stop wanna-english-server
```

如果使用宝塔 Node 项目，在面板中填写：

- 项目目录：后端项目目录
- 启动文件：`server.js`
- 端口：`3000`
- 环境变量：与项目根目录 .env 保持一致

## 四、更新后端代码

使用 Git 更新时：

```bash
cd /www/wwwroot/WannaEnglishserver
git pull
npm install
pm2 restart wanna-english-server
```

如果没有改动 `package.json`，通常可以不执行 `npm install`。如果线上是宝塔文件上传方式，则上传最新代码后，在宝塔面板重启 Node 项目即可。

更新后检查：

1. 查看 PM2 或宝塔运行状态。
2. 查看启动日志，确认没有数据库连接错误。
3. 在客户端进入登录、学习、匹配等主要流程。
4. 确认服务端口仍然是 `3000`，反向代理和域名可以访问。

## 五、数据库更新原则

### 需要执行数据库脚本

- 第一次部署数据库。
- 后端新增或补充业务表、字段、索引。
- 发布版本明确要求数据库结构更新。

### 不需要执行数据库脚本

- 只修改 Node.js 代码。
- 只修改接口逻辑或日志。
- 只修改前端代码。

### 标准操作顺序

1. 确认线上数据库名称和连接账号。
2. 备份数据库。
3. 查看 SQL 文件说明，确认不会影响单词基础表。
4. 执行现有 SQL 文件，不要随意新增迁移文件。
5. 重新检查表结构和关键数据数量。
6. 重启后端并测试主要功能。

数据库备份示例：

```bash
mysqldump -u 数据库用户名 -p forgeti > forgeti_backup_日期.sql
```

不要在没有备份和确认的情况下执行 `DROP DATABASE`、批量删除或覆盖线上数据。测试数据可以清理，但需要先确认没有误包含单词基础数据。

## 六、当前重要业务约定

- 真人匹配会持续等待真人，不会自动转成机器人，也不会新增 `timeout` 终态。
- 人机练习使用机器人语义，和真人匹配是两种不同模式。
- 自选词最多保存 7 个。
- 13 个单词的缓存由前端负责，后端只提供稳定的单词查询和抽词接口。
- 单词基础表必须保留，不能当作测试数据删除。

## 七、常见问题排查

### 服务启动失败

先查看完整日志：

```bash
pm2 logs wanna-english-server --lines 100
```

常见原因：

- .env 不存在或数据库配置错误。
- MySQL 没有启动。
- 依赖没有安装，重新执行 `npm install`。
- 端口 `3000` 已被其他进程占用。
- Node.js 版本过低。

### 检查端口是否监听

```bash
ss -lntp | grep 3000
```

### 数据库连接失败

检查以下内容：

- MySQL 服务是否运行。
- 数据库名是否为 `forgeti`。
- .env 中的账号和密码是否正确。
- 宝塔防火墙和服务器防火墙是否限制了数据库连接。

### 修改后没有生效

通常是服务没有重启，执行：

```bash
pm2 restart wanna-english-server
pm2 logs wanna-english-server --lines 50
```

## 八、上线前检查清单

- [ ] 已备份线上数据库。
- [ ] 已确认 .env 配置正确，且没有把密钥提交到代码仓库。
- [ ] 需要数据库变更时，已确认 SQL 影响范围。
- [ ] 单词基础表未被删除或清空。
- [ ] 后端进程状态正常。
- [ ] 启动日志没有报错。
- [ ] 客户端可以正常登录和进入主要功能。
- [ ] 真人匹配仍然等待真人，不会出现机器人 fallback 或 `timeout`。
