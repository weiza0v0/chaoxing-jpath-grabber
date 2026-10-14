# chaoxing-jpath-grabber

把**超星 jpath 电子书阅读器**（`reader.shtml`）里正在看的整本书，抓成本地 PDF。

- **前端** —— 一段浏览器 Console 脚本，粘贴即用
- **后端** —— 本机接收器 + PDF 拼装，**零第三方依赖**（只用 Python 标准库）
- **产物** —— 书页原图（无损）+ 一个可搜索书签的 PDF

> 最初是为了下载教材平台上的课程教材而写的，但代码里没有任何站点相关的硬编码：
> 只要还是这套超星 jpath 阅读器，换书、换图书馆都能直接用。

---

## 目录

- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [使用步骤](#使用步骤)
- [输出长什么样](#输出长什么样)
- [工作原理](#工作原理)
- [配置项](#配置项)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [免责声明](#免责声明)

---

## 环境要求

| 项目 | 要求 |
|---|---|
| Python | **3.8+**（启动脚本会自动找，找不到会尝试帮你装） |
| 第三方包 | **无**。不需要 `pip install` 任何东西 |
| 浏览器 | Chrome / Edge（需支持 Private Network Access，2022 年后的版本都行） |
| 网络 | 能正常登录图书馆、打开阅读器即可 |

> **关于"自动安装依赖"**：本项目刻意做成了零依赖，所以严格来说没有依赖可装。
> 启动脚本做的是「环境自检 + 缺失时尝试安装 Python 本身」，并跑一遍标准库自检
> （`zlib` / `struct` / `http.server` 等）确认 Python 装得完整。

---

## 快速开始

先把仓库放到你喜欢的目录，然后：

### Windows

**推荐：先跑一次 `backend\start.bat`，它会引导一个便携版 Python。**

```bat
backend\fetch-runtime.bat     rem 一次性：下 10MB 嵌入式 Python 到 <repo>\runtime
backend\start.bat             rem 之后就一直用它
```

`fetch-runtime.bat` 用 Windows 自带的 `curl.exe` 下载、`tar.exe` 解压，
**不需要你已经有 Python** —— 它是从零引导的。装完的位置是 `<repo>\runtime\python`，
不写注册表、不动 PATH，删掉这个文件夹就等于卸载。

`start.bat` 的搜索顺序（**只认显式路径**）：

| 顺序 | 位置 | 说明 |
|---|---|---|
| 0 | `<repo>\runtime\python` | 便携版，跑过 `fetch-runtime.bat` 才有 |
| 1 | `py -3` | 官方 Python Launcher |
| 2 | conda / miniconda / anaconda 常见安装位置 | `%USERPROFILE%\miniconda3` 等 |
| 3 | 都没有 → 提示用 `winget` 装 | |

> **Windows 端刻意不在 PATH 里找 `python`。** 因为那里十有八九是
> `LOCALAPPDATA\Microsoft\WindowsApps\python.exe` —— 一个 **2 字节**的微软商店
> 占位程序，跑起来只会弹商店；就算它是真的，到底是哪个解释器胜出也不可预测。
> 每个候选都会**实际运行验证**才采纳。
>
> Linux 端相反：`python3` 在 PATH 里是常态，`start.sh` 就用 `command -v` 找它。

> 窗口不会一闪而过 —— 每条退出路径都有 `pause`。如果确实闪退了，
> 见 [排障文档](docs/TROUBLESHOOTING.md#双击-startbat窗口闪一下就关了)。

习惯 PowerShell 的话用 `backend\start.ps1`：

```powershell
powershell -ExecutionPolicy Bypass -File backend\start.ps1
```

### Linux / macOS

```bash
chmod +x backend/*.sh          # 第一次用
./backend/start.sh
```

它会自动找 `python3`，没有就按发行版尝试用 `apt` / `dnf` / `yum` / `pacman` /
`apk` / `brew` 安装。

启动成功会看到：

```
==============================================================
 chaoxing-jpath-grabber  collector v1.0.0
==============================================================
 监听    http://127.0.0.1:8765
 输出    /path/to/repo/output
 前端    /path/to/repo/frontend/grabber.js

 接下来：在阅读器页面 F12 → Console 里粘贴 frontend/grabber.js
 停止：Ctrl+C
==============================================================
```

**这个窗口要一直开着**，抓取期间别关。

---

## 使用步骤

1. **启动后端**（上一步），窗口保持开着。

2. **打开阅读器**：从教材平台点「本地全文」，等书页显示出来。

3. **粘贴前端脚本**：`F12` → `Console` → 把 `frontend/grabber.js` **全文**粘进去 → 回车。

   > 第一次粘贴时 Chrome 可能提示 `Warning: Don't paste code...`，
   > 按提示输入 `allow pasting` 回车，再粘一次。

4. **如果页面是 `http://…:9088`**：脚本会弹窗说需要切到 HTTPS。
   点确定后页面自动跳转，**脚本源码已经帮你放进剪贴板了 —— 直接 `Ctrl+V` 再回车**
   即可。（因为跳转会终止脚本，这一步没法省；下面「常见问题」里有零点击的办法。）

5. **等右下角面板走完**：

   ```
   jpath-grabber
   状态：✔ PDF 已生成
   已收 415 页　跳过 0　失败 0
   415 页 → /path/to/repo/output/ssno12316670_7b9561d0.pdf
   ```

搞定。PDF 就在 `output/` 下。

### 想重拼 PDF / 换 DPI

```bash
# 列出抓到的书
./backend/make-pdf.sh            # Windows: backend\make-pdf.bat

# 重新拼，改页面物理尺寸
./backend/make-pdf.sh ssno12316670_7b9561d0 --dpi 200
```

---

## 输出长什么样

```
output/
├── ssno12316670_7b9561d0/            ← 书页原图（无损，可用来重拼）
│   ├── cov001.jpg  cov002.jpg
│   ├── bok001.jpg  leg001.jpg
│   ├── fow001.jpg  fow002.jpg
│   ├── !00001.jpg … !00004.jpg
│   ├── 000001.jpg … 000405.jpg
│   └── order.txt                     ← 前端记录的页序
├── ssno12316670_7b9561d0.pdf         ← 成品
└── collector.log
```

实测一本书：**415 页 / 31.7 MB 原图 → 31.9 MB PDF**。

体积几乎不涨，是因为拼装时**完全没有重编码**：

| 输入格式 | 在 PDF 里怎么存 |
|---|---|
| JPEG | `/DCTDecode`，原字节直接塞进去 |
| PNG（调色板） | `/FlateDecode` + `/Indexed` 调色板，原 IDAT 直接塞进去 |
| PNG（灰度/真彩） | `/FlateDecode` + `Predictor 15`，原 IDAT 直接塞进去 |

对比一下：如果用「统一转 JPEG 再拼」，同样这本书会变成 **300 MB+**，
而且扫描件的文字边缘会糊。用 PyMuPDF 那种通用库则是 63 MB ——
因为它会把调色板 PNG 展开成 RGB 再压。

---

## 工作原理

```
┌─ 浏览器（frontend/grabber.js）────────────────────────────────┐
│                                                              │
│  ① 等阅读器就绪，从 performance 网络记录里还原图片前缀：      │
│       https://<host>/jpath/img/<书目录长hex>/0/0/<32hex>/     │
│                                                              │
│  ② 二分搜索正文页号上限 N，然后按页号直接枚举：               │
│       000001.jpg … 0000NN.jpg                                │
│     再探前置页 cov / bok / leg / fow* / !*（目录）            │
│                                                              │
│  ③ 每页 fetch 下来（同源 + 带 cookie），POST 给本机接收器      │
└──────────────────────────────────────────────────────────────┘
                          │ HTTP / 127.0.0.1:8765
                          ▼
┌─ 本机（backend/collector.py）────────────────────────────────┐
│  按书分目录落盘 → 写入 order.txt → 触发 build_pdf.py          │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ 本机（backend/build_pdf.py，纯标准库）──────────────────────┐
│  推断页序 → 按格式无损嵌入 → 输出 PDF                         │
└──────────────────────────────────────────────────────────────┘
```

### 关键点 1：为什么要分前后端？

图书馆平台走 CAS 单点登录，登录 cookie 是 `HttpOnly` 的 —— **JS 读不出来，
也就没法交给后端**。所以「带认证取数」这件事物理上只能在浏览器里发生。
而落盘和拼 PDF 交给本机进程更稳：不受标签页内存上限、被 Chrome 回收的影响，
出问题还能重跑。

### 关键点 2：为什么不能用 DOM 抓图？

书页是**画在 `<canvas>` 上**的，DOM 里根本没有 `<img>`，所以
`document.querySelectorAll('img')` 一条都找不到（这也是最初的坑）。
唯一可靠的办法是读 `performance.getEntriesByType('resource')`，
从真实网络请求里还原地址。

### 关键点 3：为什么要切到 HTTPS？

书页图片的真实来源是 `https://<host>/iis/png/png.dll?pid=…`
（个人水印就是它现渲染上去的）。而教材平台的默认入口是
`http://<host>:9088/…`，图片会 302 跨协议跳到 443 —— 跨协议即跨源，
`fetch` 必被 CORS 挡掉。

把页面换成 `https://<host>/…`（去掉端口）后两者同源，问题消失。

### 关键点 4：页序怎么定？

超星 PDG 的命名规律：

```
cov001  封面          bok001  书名页       leg001  版权页
fowNNN  前言          !NNNNN  目录(罗马数字页)
NNNNNN  正文          cov002 / bak001  封底
```

`build_pdf.py` 的 `reading_order()` 就按这个排序。
如果某本书不符合规律，在那个书目录里放一个 `order.txt`（每行一个文件名）
即可覆盖 —— 前端也会把它记录的页序自动写进 `order.txt`。

### 关键点 5：滚动兜底

万一直取模式失败（比如某本书的前缀是**按页窗口**生成的，而不是整本固定），
脚本会自动切到滚动兜底模式：一边滚阅读器一边从网络记录里收页。
这条路更慢（约 3~4 分钟/本）但适应性更强。用 `CFG.mode` 可以强制指定。

---

## 配置项

`frontend/grabber.js` 顶部的 `CFG`：

| 键 | 默认 | 说明 |
|---|---|---|
| `mode` | `'auto'` | `auto` / `direct`（只直取）/ `scroll`（只滚动） |
| `maxPage` | `2000` | 正文页号二分搜索上限 |
| `concurrency` | `5` | 同时下载几页 |
| `maxFow` | `40` | 前言类最多探到 `fow0NN` |
| `maxBang` | `99` | 目录类最多探到 `!NNN` |
| `scrollStep` | `1.15` | 兜底模式：每步滚多少倍可视高度 |

`backend/collector.py` 命令行：

```
--host 127.0.0.1   监听地址（别随便改成 0.0.0.0）
--port 8765        端口
--out  <目录>      输出根目录，默认 <repo>/output
--quiet            安静模式
```

如果改了端口，记得同步改 `grabber.js` 里的 `COL`。

---

## 分发给别人（打包）

### 先说结论：**不要打包 conda 环境**

本项目**零第三方依赖**，只用 Python 标准库。所以 `conda-pack` / `venv` / `pip freeze`
那一套在这里是纯浪费 —— 你会为了给对方一份「Python 标准库」而打包几百 MB：

| 方案 | 体积 | 对方需要什么 |
|---|---|---|
| `conda-pack` 打包整个环境 | 300 ~ 500 MB | 解压即用 |
| venv + pip freeze | 50 ~ 100 MB | 对方要装 Python |
| **官方嵌入式解释器（本仓库方案）** | **10.5 MB** | **解压双击即用，什么都不用装** |

真正的问题从来不是"缺依赖"，而是"**对方机器上根本没有 Python**"。
嵌入式解释器正好对症：单文件、免安装、无注册表污染。

### 打一个免安装的 Windows 包

```bash
./dist/build-win.sh                      # 默认 Python 3.12.7
PYVER=3.13.1 ./dist/build-win.sh         # 换版本
./dist/build-win.sh --no-cache           # 强制重新下载
```

产物：`dist/out/jpath-grabber-win64-<版本>.zip`（约 10.5 MB）

里面装的是：

```
jpath-grabber-win64/
├── start.bat          双击即用（用自带的 Python）
├── make-pdf.bat       手动重拼
├── python/            官方 Windows 嵌入式解释器（35 个文件）
├── backend/           collector.py · build_pdf.py · books.py
├── frontend/          grabber.js
├── output/            抓取结果落这里
├── README.txt         给收包的人看的说明（中文）
└── LICENSE.txt
```

收包的人：**解压整个 zip → 双击 `start.bat`**。不需要装 Python。

如果 `<repo>/runtime/python` 已经存在（跑过 `fetch-runtime.bat`），
打包会**直接复用它**，省一次下载，而且打出来的包和你本地验证过的解释器完全一致。

下载解释器时脚本会依次尝试
**npmmirror 镜像 → 华为云镜像 → python.org**，并且对国内镜像**不走代理**
（走代理反而容易被节点掐断大文件）。

> 实测：`dist/build-win.sh` 在 WSL 里跑，10.6 MB 的镜像下载 1.1 秒完成；
> 打出来的包在真 Windows 上解压后，自带的 Python 独立完成了
> 落盘 + 拼装，产出 PDF 校验通过。

### Linux 端

不打包。主流发行版都自带 `python3`，直接用 `backend/start.sh` 就行。
真需要免安装的 Linux 二进制，可以考虑
[python-build-standalone](https://github.com/astral-sh/python-build-standalone)，
但本仓库没做。

### 维护提醒

`.bat` / `.ps1` 必须保持 **纯 ASCII + CRLF**，`dist/build-win.sh` 在打包前会
强制自检这一点。原因见 [排障文档](docs/TROUBLESHOOTING.md#双击-startbat窗口闪一下就关了)。

---

## 自测

仓库自带一个**端到端自测**：把**真实的** `frontend/grabber.js` 放进一个最小化的
假浏览器环境里跑，验证「二分搜索页数 → 前置页探测 → 页序 → 推送 collector →
触发拼装」整条链路。不需要 `npm install`（用 Node 18+ 自带的 `fetch`）。

```bash
# 1. 生成测试用假书页（21 张：12 正文 + 封面/书名/版权/前言/目录/封底）
python3 tests/make-fixtures.py

# 2. 启动后端（另开一个窗口）
python3 backend/collector.py

# 3. 跑自测
node tests/e2e-mock.js
```

期望输出：

```
[jpath-grabber] 正文页号范围 1 ~ 12
[jpath-grabber] 前置页: cov001.jpg,bok001.jpg,leg001.jpg,cov002.jpg | 前言 2 | 目录 3
[jpath-grabber] 完成：新增 21 页，跳过 0 页，失败 0 页
状态: ✔ PDF 已生成
```

再跑一次会看到 `新增 0 页，跳过 21 页` —— 那是 `/have` 跳过逻辑在起作用。

---

## 常见问题

见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)，里面按**报错原文**索引，
包含我们开发过程中真实踩过的每一个坑：

- `blocked by CORS policy … png.dll` —— 页面是 HTTP，要切 HTTPS
- 面板卡在「连通性自检…」不动 —— 接收器被 keep-alive 死锁（旧版 bug，已修）
- `Allow pasting` —— Chrome 的粘贴保护
- 抓完发现少页 —— 用 `--list` 查断号，重跑脚本会自动跳过已下载的页
- 页面切到后台就停了 —— 这是**故意**的，阅读器懒加载依赖渲染

---

## 已知限制

1. **得靠浏览器**。因为认证在浏览器里，没法做成纯命令行工具。
2. **迁移到新机器时**要重新粘贴脚本（没做成浏览器扩展）。
3. **HTTP → HTTPS 要两次粘贴**（跳转会终止脚本）。想要零点击的话，
   可以把 `grabber.js` 做成本地书签脚本，或者装 Tampermonkey 包成用户脚本。
4. 页序规律是**推断**的。遇到不符合超星命名习惯的书，需要手工写 `order.txt`。
5. 只处理 **JPEG / PNG**。带透明通道（RGBA）或交错（Adam7）的 PNG 会跳过并告警 ——
   这种图在扫描书里基本不会出现。

---

## 免责声明

本项目仅用于**个人学习、离线阅读**已有合法访问权限的文献。

- 抓下来的页面通常带**个人水印**（姓名 + 日期），这是平台加的，请勿传播
- 请遵守你所在图书馆的数据库使用协议，不要批量抓取、不要二次分发
- 作者不对任何滥用行为负责

---

## License

[MIT](LICENSE)
