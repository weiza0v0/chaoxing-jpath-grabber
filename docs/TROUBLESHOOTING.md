# 排障

按**报错原文**索引。前面几个都是开发过程中真实踩过的坑，附了根因。

---

## 双击 `start.bat`，窗口闪一下就关了

**症状**：黑窗口一闪而过，什么都看不清。

**怎么看到真正的报错**：别双击，先开一个 `cmd` 窗口再手动跑，输出就不会消失：

```bat
cd /d D:\Desktop\chaoxing-jpath-grabber\backend
start.bat
```

**常见原因一：脚本编码不对（我们自己踩过）**

`cmd.exe` 读 `.bat` 文件用的是 **OEM 代码页**（中文 Windows 上是 GBK），
不会认 UTF-8。如果 `.bat` 是 UTF-8 存的、里面还有中文，cmd 会把三字节的汉字
两两组合，**把后面紧跟的 ASCII 字符一起吞掉**：

```
'不装任何' 不是内部或外部命令
'ocal'    不是内部或外部命令      <- setlocal 的 setl 被吃了
此时不应有 &&。
```

解析阶段就崩，根本走不到 `pause`，所以窗口一闪而过。

**本仓库的 `.bat` / `.ps1` 一律保持「纯 ASCII + CRLF 换行」**，改的时候请务必维持。
（`.sh` 不受影响，bash 正常处理 UTF-8。）

---

## Windows 上脚本说「no usable Python」，但 `where python` 明明能找到

很可能你找到的是**微软商店的占位程序**，不是真 Python：

```bat
where python
rem C:\Users\<你>\AppData\Local\Microsoft\WindowsApps\python.exe
```

去看那个文件大小 —— 如果是 **2 字节**，那就是个 App Execution Alias 占位符，
运行它只会弹微软商店，`python -V` 什么都不输出。

**四个办法**（推荐第 1 个）：

1. **跑一次 `backend\fetch-runtime.bat`** —— 一条命令引导一个便携版 Python 到
   `<repo>\runtime`，不需要你已经有 Python，不动注册表不动 PATH。
   之后 `start.bat` 会优先用它。
2. 让 `start.bat` 用 winget 装（它检测到这种情况会主动提示）；
3. 自己装：<https://www.python.org/downloads/>，记得勾 **Add python.exe to PATH**，
   或者装上 conda/miniconda —— `start.bat` 会去常见安装位置找；
4. **在 WSL 里跑后端**：
   ```bash
   ./backend/start.sh
   ```
   Windows 浏览器照样能访问 `127.0.0.1:8765` —— 前提是 `.wslconfig` 里
   `networkingMode=mirrored`（见下一节）。

> 顺带说明：Windows 端的 `start.bat` **不会**去 PATH 里找 `python`，就是为了
> 绕开这个占位程序。Linux 端则正常用 PATH 里的 `python3`。

---

## `has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header`
## `net::ERR_FAILED 200 (OK)` 指向 `iis/png/png.dll`

**现象**：自检阶段就失败，一页都抓不到。

**根因**：你打开的阅读器是 `http://<host>:9088/…`。书页图片会 302 跳到
`https://<host>/iis/png/png.dll?pid=…`，**跨协议 = 跨源**，`fetch` 被 CORS 拦掉。
阅读器自己用 `<img>` 加载不受影响，但我们要读字节，绕不过去。

**解决**：把地址栏的

```
http://<你的图书馆域名>:9088/jpath/reader/reader.shtml?...
```

改成（**去掉端口，换 https**）

```
https://<你的图书馆域名>/jpath/reader/reader.shtml?...
```

Cookie 是按域名存的、不含端口，所以登录态会跟过去，不用重新登录。

> 新版的 `grabber.js` 会自动检测并弹窗帮你跳转，还会把源码放进剪贴板，
> 跳过去后 `Ctrl+V` + 回车即可。

---

## 面板卡在「连通性自检…」/「等待阅读器加载书页…」不动，控制台也没有报错

**根因（如果后端是你自己照着旧版抄的）**：接收器用了单线程 `HTTPServer`。
配合 `HTTP/1.1` 的 keep-alive，它处理完**第一个**请求后就一直守在那条连接上等
下一个请求，**再也不 accept 新连接**了。浏览器后续的 POST 全部挂起。

**判定方法**：看 `output/collector.log`。如果只收到一两条记录就停了，就是这个问题。

**解决**：本仓库的 `collector.py` 已经改用 `ThreadingHTTPServer`，并给客户端加了
30 秒超时。如果你在改代码，务必保留这两点。

---

## `Warning: Don't paste code into the DevTools Console…`

Chrome 的粘贴保护。

**解决**：在 Console 里手动输入 `allow pasting` 回车，然后再粘一次。

或者改用 **Sources → Snippets**：新建一个 snippet，把脚本粘进去，`Ctrl+Enter` 运行。
好处是以后重跑只需点一下 ▷，不用再粘贴。

---

## 面板显示 `✔ 完成 N 页` 但 N 明显偏少

**根因**：滚动兜底模式下，每步滚 1.15 屏，个别页正好卡在两次滚动之间，从没进入
视口，就没触发懒加载。

**解决**：

1. 先查断号：
   ```bash
   python3 backend/build_pdf.py output/<书标识> --list
   ```
2. 直接**重跑一次脚本**。它会先向接收器要一份「已有哪些页」的清单，
   **只补缺的**，已下载的不会重复拉。
3. 如果缺口很大，把 `CFG.scrollStep` 调小（比如 `0.6`）再跑。

> 正常情况下走的是**直取模式**，按页号枚举，不会有缺口。

---

## 页面切到后台 / 最小化后，抓取就停住了

**这是故意的，不是 bug。**

两个原因：

1. Chrome 会把后台标签页的定时器节流到约 1 秒一次，轮询精度全乱；
2. 更关键的是，阅读器的懒加载靠「元素进入视口」触发，页面被隐藏时渲染停摆，
   新页根本不会加载 —— 硬跑会被误判成「到书末」而**提前收工**，拿到残缺的 PDF。

脚本检测到 `document.visibilityState === 'hidden'` 会暂停并提示，切回前台自动继续。

**建议**：跑之前把窗口往屏幕一边吸附留一条可见，别最小化、别锁屏。

---

## `curl: (7) Failed to connect to 127.0.0.1 port 8765`

后端没起来，或者端口不对。

```bash
curl http://127.0.0.1:8765/
# 正常应返回 collector 版本号和各书进度
```

如果改了 `--port`，记得同步改 `frontend/grabber.js` 里的 `COL`。

---

## 页面里有书页，但脚本报「找不到书页地址」

阅读器可能还没开始加载任何书页，所以网络记录里还没有图片请求。

**解决**：在阅读器里滚一下/翻一页，等书页显示出来，再运行脚本。
脚本本身会等 40 秒并主动推一把，通常不用手动干预。

---

## WSL 里跑后端，Windows 浏览器连不上

WSL2 默认的 NAT 模式下，Windows 的 `127.0.0.1` 和 WSL 的不是同一个。

**解决**：在 `C:\Users\<你>\.wslconfig` 里加

```ini
[wsl2]
networkingMode=mirrored
```

然后 `wsl --shutdown` 重启 WSL。镜像模式下两边共享 localhost，
浏览器就能直接访问 `127.0.0.1:8765` 了。

---

## PDF 打不开 / 页数不对

先自查：

```bash
python3 backend/build_pdf.py output/<书标识> --list      # 页序对不对
python3 -c "import fitz;d=fitz.open('output/<书标识>.pdf');print(d.page_count)"
```

页序不符合超星命名习惯的话，在那个书目录里放一个 `order.txt`
（每行一个文件名），`build_pdf.py` 会以它为准。

---

## 想抓另一本书

直接重来一遍就行，后端不用重启：

1. 教材平台 → 点「本地全文」
2. 需要的话改成 `https://…`（去掉 `:9088`）
3. 粘 `grabber.js`
4. 等它跑完

每本书按 `ssno_<书号>_<code前8位>` 分目录存放，互不干扰。
新书会走一遍 `/have` 查询，因为是空目录，所以会全量下载。
