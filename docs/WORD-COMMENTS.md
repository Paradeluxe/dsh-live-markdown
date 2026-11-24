# Word 批注：实测得到的格式与行为，以及复刻规格

> 这份文档是 `word-comments` 开发线（fork 自 v1.3.17）的研究底稿。每条结论尽量标注来源：
> **[实测]** = 本机 Word 16.0（Office 365）写的真实 docx 解包得到；**[文档]** = Microsoft 公开文档描述；
> **[待验证]** = 还没测到，先记下来。

## 0. 研究材料

| 材料 | 路径 | 用途 |
| --- | --- | --- |
| 真实批注样本（嵌套/回复） | `E:\hermes_playground\docx-testbed\test_nested.docx` | 48 条批注、24 组回复、`w15:done` 全为 0 |
| 基础样本 | `docx-testbed\test_with_comments.docx`、`test_overlap.docx` | 重叠锚点 |
| 真实稿件（含批注） | `jspace-repo\manuscript\JSpace_Liu_Oct09_2026.docx` | Word 正常模式写出的批注 |
| 解包工具 | `.dsh-scratch\dump-docx-comments2.ps1`、`scan-docx-comments.ps1`、`scan-comment-vocab.ps1` | 只读解包、词表统计 |
| Word 窗口截图 | `.dsh-scratch\shots\word-front2.png` | 经典批注卡片外观 |

Word 的 COM 对象模型（`Document.Comments`）只暴露 `Index / Author / Initial / Date / Done / Scope / Range / Ancestor`，
存不下格式细节，所以**以 docx 包里的 XML 为准**。

## 1. docx 里的批注包结构

### 1.1 五个部件 **[实测]**

| part | content type | relationship type |
| --- | --- | --- |
| `word/comments.xml` | `application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml` | `http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments` |
| `word/commentsExtended.xml` | `…wordprocessingml.commentsExtended+xml` | `http://schemas.microsoft.com/office/2011/relationships/commentsExtended` |
| `word/commentsIds.xml` | `…wordprocessingml.commentsIds+xml` | `http://schemas.microsoft.com/office/2016/09/relationships/commentsIds` |
| `word/commentsExtensible.xml` | `…wordprocessingml.commentsExtensible+xml` | `http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible` |
| `word/people.xml` | `…wordprocessingml.people+xml` | `http://schemas.microsoft.com/office/2011/relationships/people` |

关系都挂在 `word/_rels/document.xml.rels` 里；`[Content_Types].xml` 里每个部件各有一条 `<Override>`。
缺 `commentsExtended/Ids/Extensible` 时 Word 仍能显示批注，但没有线程与「已解决」状态。

### 1.2 正文锚点（document.xml） **[实测]**

```xml
<w:p>
  <w:commentRangeStart w:id="1"/>
  <w:commentRangeStart w:id="2"/>
  <w:r><w:t>The audio recordings are publicly available at https://osf.io/wjdyr/</w:t></w:r>
  <w:commentRangeEnd w:id="1"/>
  <w:r><w:rPr><w:rStyle w:val="ae"/></w:rPr><w:commentReference w:id="1"/></w:r>
  <w:commentRangeEnd w:id="2"/>
  <w:r><w:rPr><w:rStyle w:val="ae"/></w:rPr><w:commentReference w:id="2"/></w:r>
  <w:r><w:t>. Ground-truth manual annotations …</w:t></w:r>
</w:p>
```

规则：

- `w:commentRangeStart` 落在被批注的**第一个字符之前**，`w:commentRangeEnd` 在最后一个字符之后；
- 每个 end 后面紧跟一个 run，run 里是 `w:commentReference w:id`（`w:rStyle w:val="ae"` 是 CommentReference 字符样式，渲染成小标记）；
- **允许嵌套与重叠**：多个 start 可以连着出现，各自的 end/reference 依次收尾（样本里 144 个标记，2 条批注锚在同一句上）；
- 锚点可以**跨段落**：每个段落里各有一对 start/end；
- 空范围（删掉了被批注的文字）会只剩 `w:commentReference`，没有 start/end —— 云同步脚本里把这个叫「空锚点」，是需要修复的坏状态。

### 1.3 comments.xml 内部 **[实测]**

```xml
<w:comments>
  <w:comment w:id="1" w:author="haoyunzhang" w:date="2026-05-20T15:40:00Z" w:initials="hZ">
    <w:p w14:paraId="6D9B9F1E">
      <w:pPr><w:pStyle w:val="af"/></w:pPr>
      <w:r><w:rPr><w:rStyle w:val="ae"/></w:rPr><w:annotationRef/></w:r>
      <w:r><w:t xml:space="preserve">Do we have the right to make it publicly available? …</w:t></w:r>
    </w:p>
    <w:p w14:paraId="19D95F3C"><w:pPr><w:pStyle w:val="af"/></w:pPr></w:p>
    <w:p w14:paraId="61B8BC36"><w:pPr><w:pStyle w:val="af"/></w:pPr><w:r><w:t>There is nothing there now.</w:t></w:r></w:p>
  </w:comment>
</w:comments>
```

- 一条批注 = 1..n 个 `w:p`（用户在批注框里按 Enter 分段），每段带 `w14:paraId`；
- 第一段第一个 run 固定是 `w:annotationRef`（带 `rStyle=ae`），就是正文里看到的批注标记；
- 段落样式 `w:pStyle w:val="af"` 在 Word 自带模板里叫「批注文字」（Comment Text）；导入时要按**样式名**反查 id，不能写死 `af`；
- `w:author` 是显示名，`w:initials` 是头像里的字母，`w:date` 是 ISO 时间；
- **时间坑**：`w:date="2026-05-20T15:40:00Z"` 实际是**本地时间**（香港 15:40），真 UTC 写在 `w16cex:dateUtc`（`07:40:00Z`）。导入导出时要两个都维护，不能只看 `w:date`。

### 1.4 commentsExtended.xml：线程与「已解决」 **[实测]**

```xml
<w15:commentsEx>
  <w15:commentEx w15:paraId="61B8BC36" w15:done="0"/>
  <w15:commentEx w15:paraId="5F60B5C2" w15:paraIdParent="61B8BC36" w15:done="0"/>
</w15:commentsEx>
```

- `w15:paraId` = 该批注**最后一段**的 `w14:paraId`（不是第一段！样本里批注 1 的三段 paraId 是
  `6D9B9F1E / 19D95F3C / 61B8BC36`，commentEx 用的是 `61B8BC36`）；
- 顶层批注没有 `w15:paraIdParent`；**回复**用 `w15:paraIdParent` 指向父批注的 paraId；
- `w15:done="1"` = 已解决（UI 的「解决」）；Word 把解决状态放在这里，不在 comments.xml。
- **done 是线程级的**：XML 只写在根批注的 commentEx 上，但 Word 的 `Comment.Done` 对同一线程里的
  回复也返回 true（实测：`JSpace_Liu_Oct09_2026.docx` 里 3 个线程 done=1，COM 数出 6 条 done=true，
  正好是 3 个根 + 3 条回复）。我们自己的模型按线程存 done，UI 里回复跟着根走。

### 1.5 commentsIds.xml 与 commentsExtensible.xml：durableId **[实测]**

```xml
<w16cid:commentsIds>
  <w16cid:commentId w16cid:paraId="61B8BC36" w16cid:durableId="37B0C978"/>
</w16cid:commentsIds>
<w16cex:commentsExtensible>
  <w16cex:commentExtensible w16cex:durableId="37B0C978" w16cex:dateUtc="2026-05-20T07:40:00Z"/>
</w16cex:commentsExtensible>
```

- `paraId` 是段落级随机 id（每段一个），`durableId` 是批注级 8 位十六进制 id，**跨会话/跨设备稳定**；
- 两者一一对应，是协同编辑里追踪同一条批注的主键；
- `commentsExtensible` 还能挂 `cr:reactions`（Word 的批注表情回应），样本里声明了 `cr` 命名空间但没数据 —— **[待验证]** 结构。

### 1.6 people.xml：作者身份 **[实测]**

```xml
<w15:people>
  <w15:person w15:author="haoyunzhang">
    <w15:presenceInfo w15:providerId="AD" w15:userId="S::haoyunzhang@um.edu.mo::ea5270fb-af3b-468e-ab64-db3b93e3cff1"/>
  </w15:person>
  <w15:person w15:author="Liu Zhengyuan">
    <w15:presenceInfo w15:providerId="AD" w15:userId="S::yc57337@um.edu.mo::302d2d52-…"/>
  </w15:person>
</w15:people>
```

- `w15:author` 与 comments.xml 的 `w:author` 对应；`providerId` 实测是 `AD`（企业目录），个人版常见 `PeoplePicker` / `WindowsLiveId` / `OrgId` / `None`；
- `userId` 形如 `S::<email>::<guid>`；
- 没有 people.xml 也能显示作者名字（只是点不开联系人卡片）。

### 1.7 兼容模式会改变 UI 形态 **[实测]**

`test_nested.docx` 用 Word 打开标题是「… - 兼容性模式」，右边缘显示的是**经典白色批注卡片**（头像 + 名字 + 时间 + 正文）；
现代（compatibilityMode ≥ 15）文档才是带「答复 / 解决」的批注窗格。所以：**我们导出的 docx 必须写 `w:compat` 的
`compatibilityMode=15`**，否则用户拿到的永远是经典形态。

### 1.8 写回去时踩过的四个坑 **[实测]**

导出（`src/comments/docx-export.js`）被 Word 接受之前，实测踩了四个坑，都是「结构看着对、Word 就是不认」的类型：

| # | 现象 | 原因 | 正确做法 |
| --- | --- | --- | --- |
| 1 | Word 打开后批注条数、位置都对，但「已解决」和「回复线程」全丢 | **`paraId` / `durableId` 最高位必须为 0**（值 < `0x80000000`）。用满 32 位随机值时，约一半批注会静默丢失线程/已解决状态：同一份数据导出两次，一次 `ancestor=1`、一次 `ancestor=none`，差别只在 id 取值。Word 自己写的 id 全是 `0x0`–`0x7` 开头 | 生成 id 时只用 `Math.random() * 0x80000000` |
| 2 | 补上第 1 条后，done/线程仍然全丢 | 批注段落缺 `w:rsidR` / `w:rsidRDefault`，Word 会重排段落 id，导致 `commentEx` 的 paraId 对不上 | 批注 `<w:p>` 带上 `w:rsidR="00000000" w:rsidRDefault="00000000"` |
| 3 | 一条批注多段时，只有最后一段生效 | 所有段落共用一个 paraId，Word 要求**每段唯一**；`commentEx` / `commentId` 只引用**最后一段**的 id | 一段生成一个 paraId，记录最后一段给 commentEx 用 |
| 4 | 删旧批注时正文被删掉一大段 | 用 `<w:rPr>[\s\S]*?<\/w:rPr>` 清空 run 会跨过中间正文匹配到后面的 `</w:r>` | 用「匹配到第一个 `</w:r>`」的方式判断空 run |

另外一条 **Word 自身的怪癖**：范围结束在段落末尾的批注，`Comment.Scope` 的 `Start == End`（长度为 0）。
这不是锚点丢失 —— Word 自己写的 `test_nested.docx` 里同样有 4 条这样的批注（id 133/90/111/117）读出来也是 0 长度。
判断锚点是否丢失要看 `w:commentReference` 是否还在、以及我们自己的文本偏移解析。

### 1.9 读取实现与实测校验 **[实测]**

`src/comments/docx-comments.js`（零依赖，只用 `node:zlib` 解 zip）已经能读出上面全部信息，
并用 Word 16.0 的 COM 结果做了对照（脚本：`scripts/comments-test.mjs`，Word 侧：`.dsh-scratch/word-count-comments.ps1`）：

| 文档 | Word `Comments.Count` | 本实现 threads + replies | 已解决（XML 根） | Word `Done` 条数 |
| --- | --- | --- | --- | --- |
| `test_nested.docx` | 48 | 24 + 24 = **48** | 0 | 0 |
| `test_with_comments.docx` | 46 | 23 + 23 = **46** | 0 | 0 |
| `test_overlap.docx` | 49 | 26 + 23 = **49** | 0 | 0 |
| `JSpace_Liu_Oct09_2026.docx` | 22 | 11 + 11 = **22** | 3 | 6（done 继承，见 §1.4） |

另外两条实测结论：

- `w:id` **不是** 1..N 连续：`JSpace_Liu_Oct09_2026.docx` 的根批注 id 是 `0,1,2,12,11,10,15,19,18,21,23`，
  回复是 `30..48`；`Comments.Index` 按 comments.xml 里的出现顺序编号，所以解析时**保持文档序**，不要按 id 排序；
- 锚点允许零长度（批注挂在插入点上），样本里 `test_nested.docx` 有 2 条零长度锚点；这类不能当「空锚点」
  丢掉，要保留成插入点标记。

## 2. Word 的行为规格（要复刻的东西）

| # | 场景 | Word 的做法 | 我们要做到的 |
| --- | --- | --- | --- |
| 1 | 新建批注 | 选中文字 → 右键「新建批注」/ `Ctrl+Alt+M`；未选中时批注锚定到光标处的 **0 长度位置**（插入点） | **已实现**：`Ctrl+Alt+M`，空选区锚在光标处并渲染小标记 |
| 2 | 批注范围 | 高亮被批注文字；范围随编辑移动，删光了变「空锚点」 | **已实现**：quote+偏移双保险；删光后保留批注并可重新挂载 |
| 3 | 悬停 | 鼠标悬停正文高亮处/标记 → 对应批注卡片高亮；悬停卡片 → 正文范围高亮 | 双向 hover 联动 |
| 4 | 卡片位置 | 右侧页边距，垂直对齐锚点所在行；多条重叠时堆叠 | 右侧 gutter，按锚点 y 排序、重叠时错开 |
| 5 | 卡片内容 | 头像（首字母）、作者名、时间（`2026年5月20日 15:40`）、正文、底部「答复」输入框、「解决」「…」菜单 | 同左，时间格式按 UI 语言 |
| 6 | 回复 | 卡片底部输入框回车即可，回复缩进挂在父批注下；电话/网页版支持 @提及 | 二级回复 + 名字首字母头像 |
| 7 | 解决 | 「解决」按钮 → 卡片变灰、加勾；「重新打开」可恢复；已解决默认仍显示（可筛选） | 同左，`done` 状态入 comments.json |
| 8 | 编辑 | 点正文进入编辑态，可改自己的内容；他人批注只读（除非有权限） | **已实现**：作者可见「编辑」，`modifiedAt` 会更新 |
| 9 | 删除 | 「…」→ 删除，删除后正文标记消失（线程随父批注一起删） | 删除父批注时级联 |
| 10 | 窗格 | 「审阅 → 批注」打开右侧批注列表；「显示批注」开关；上一条/下一条导航 | **已实现**：面板列表 + 跳转 + 「展开/收起」 |
| 11 | 排序/筛选 | 按文档位置排序，可按「所有/已解决/我的」筛选 | **已实现**：全部 / 未解决 / 已解决 / 我的 |
| 12 | 打印 | 批注可打印在页边距（经典形态），现代默认不打印 | **已实现**：面板「打印」生成可打印清单页 |
| 13 | 复制粘贴 | 复制带批注的文字，批注一起复制；粘贴到别的文档锚点跟着来 | **部分实现**：自有 MIME 的复制粘贴已通；Word 剪贴板格式未解析 |
| 14 | 多作者 | 每个作者一个头像色；`people.xml` 存身份；同一段可挂多条批注 | 多用户、每用户颜色 |
| 15 | 协同 | 云端共编时批注实时出现，durableId 保证不重复 | **部分实现**：2.5s 轮询 + id 合并（准实时）；无推送、无 CRDT |
| 16 | 只读 | 只读文档可看批注不能改 | **已实现**：`github-md:comments-readonly` 本地开关 |

### 1.10 导出实现与 Word 验收 **[实测]**

`src/comments/docx-export.js` 能读入任意 docx（先剥掉旧批注）、按纯文本偏移插锚点、写五个部件、补 rels/Content_Types、
把 `compatibilityMode` 提到 15，再重新打包（`src/comments/zip-write.js`，零依赖）。

两个自动验收：

| 脚本 | 做什么 | 结果 |
| --- | --- | --- |
| `scripts/comments-export-test.mjs` | 3 条批注（2 根 + 1 回复，1 条已解决）写进真实 docx，再用自己的读取器读回；再导出第二次验证幂等 | **26/26** |
| `scripts/comments-word-check.mjs` | 同一份导出结果交给 **Word COM** 读回：条数、作者、锚点原文、`Ancestor`（回复挂在 1 号上）、`Done`（第一条已解决） | **6/6** |

Word 读回的实际输出：

```
name=word-check-xxxx.docx compatMode=15 count=3
  #1 author=Alice Chen done=False ancestor=none start=171 end=210 len=39 text=[Centre for Cognitive and Brain Sciences]
  #2 author=Bob Wu    done=False ancestor=1    start=171 end=210 len=39 text=[Centre for Cognitive and Brain Sciences]
  #3 author=Bob Wu    done=True  ancestor=none start=260 end=284 len=24 text=[Department of Psychology]
```

也就是说：**我们现在能写出 Word 认得、带线程和已解决状态的批注**，不只是"格式差不多的 XML"。

## 3. markdown 侧的数据模型（已实现：`src/comments/model.js`）

正文一个字都不改，批注放**侧车文件**：

```
manuscript/results_Nov18.md
manuscript/results_Nov18.comments.json
```

```json
{
  "version": 1,
  "comments": [
    {
      "id": "c_37B0C978",
      "paraId": null,
      "durableId": "37B0C978",
      "parentId": null,
      "resolved": false,
      "author": { "name": "Alice Chen", "initials": "AC", "email": "alice@example.edu", "color": "#8250df" },
      "createdAt": "2026-11-24T02:00:00.000Z",
      "modifiedAt": "2026-11-24T02:05:00.000Z",
      "body": "这里要补引用。\n\n两句之间也算一段。",
      "anchor": {
        "start": 1234,
        "end": 1268,
        "quote": "The audio recordings are publicly available",
        "prefix": "…availability:\n",
        "suffix": " at https://osf.io/wjdyr/"
      }
    }
  ]
}
```

**锚点**用 W3C Web Annotation 的组合选择器：偏移是快路径，`quote` + `prefix/suffix`（各 32 字）负责在文本被编辑后重新定位。
三种结果：`ok`（偏移仍然命中）、`moved`（在别处找到，按前后文相似度打分挑最像的）、`lost`（原文被删，
保留 `quote` 并把 start/end 置空，**不静默丢批注**，UI 里置顶成「已丢失锚点」）。

**线程**与 Word 一致：`resolved` 只写在线程根上，回复的 `parentId` 指向根；`setResolved(reply)` 会落到根上。
**删除**用墓碑：`deleted: true` + `deletedAt`，根批注级联回复，多用户合并时删除能传播出去。

**多用户合并** `mergeStores(left, right)`：按 `id` 对齐；墓碑优先；否则取 `modifiedAt` 新的一份
（`touch()` 保证时间戳严格递增，同一毫秒内连续修改也能分先后）；同一位置两人各加一条批注都保留（Word 也是这样）。

**与 docx 互通**：`toDocxComments(store)` 把 store 转成 `docx-export.js` 的输入（数字 id 给 `w:id`，
`durableId` 归一化成 8 位 hex 且最高位为 0），`fromDocxComments(result)` 反过来；
`mapDocxAnchorsToMarkdown(store, docxText, markdownText)` 负责把 docx 摊平文本上的偏移落到 markdown 上
（先按 quote 直接找，找不到再按段落近似，返回 `mapped / approx / lost` 统计）。

**API 一览**：`emptyStore / parseStore / serializeStore / anchorAt / resolveAnchor / resolveStore / buildThreads /
createComment / createReply / editComment / setResolved / deleteComment / mergeStores / toDocxComments /
fromDocxComments / mapDocxAnchorsToMarkdown / normalizeDurableId / authorColor / initialsOf`。

**验收**（两个自动脚本）：

| 脚本 | 覆盖 | 结果 |
| --- | --- | --- |
| `scripts/comments-model-test.mjs` | JSON 往返、锚点前移/移动/丢失、线程与解决/重新打开、删除级联与墓碑、多用户合并（新增/编辑冲突/删除传播/旧版本不覆盖新版本）、docx 导入 46 条 / 23 线程、model → docx → 读回 | **32/32** |
| `scripts/comments-model-word-check.mjs` | model → 侧车序列化 → 解析 → docx 导出 → **Word COM 读回**：3 条批注、回复挂在根上、线程已解决、两条锚点原文、两位作者 | **5/5** |

## 3.5 UI：正文高亮 + 页边圆点 + 悬浮卡片（已实现：`src/comments/ui.js`）

DSH 的文档面板通常只有 500–700px 宽，Word 那种常驻页边卡片会把正文挤成一列窄条，所以界面采用
**「高亮 + 页边圆点 + 悬浮卡片」**：

| 元素 | 行为 |
| --- | --- |
| 正文高亮 | 被批注的范围铺淡黄色底、下沿一条细线；悬停或打开对应卡片时加深 |
| 页边圆点 | 每条线程右侧一枚 11px 圆点，垂直对齐锚点首行；已解决的是灰色空心 |
| 悬浮卡片 | 悬停高亮 / 点圆点 / 刚新建时展开：头像（首字母 + 固定色）、作者、时间、正文、回复列表、回复/解决/删除 |
| ＋批注 | 选中文字后浮出按钮（键盘选择也会出现），点击后在选区上建一条空批注并展开输入框 |
| 键盘 | `Ctrl+Enter` 提交、`Esc` 取消或关闭卡片 |

实现要点：

- 高亮是 CM6 的 `Decoration.mark`，带 `data-comment-id`；悬停/点击都按 id 找线程；
- 圆点与卡片在一个绝对定位层里，位置用 `view.coordsAtPos()` 换算，滚动/改窗口大小时重排；
- 每次文档变化后用 `resolveStore()` 重新对锚点（偏移失效就按 quote 找），找不到的进左上角「锚点丢失」提示；
- 所有增删改都走 `model.js`，保存走 `POST /github-md/comments/save`（带 `baseMtimeMs`，磁盘更新时服务端合并）。

**批注面板（2026-11-24 追加）**：右上角一枚「批注 N」计数徽标，点开是列表：

| 元素 | 行为 |
| --- | --- |
| 计数徽标 | 有批注时出现，显示线程总数；点一下开/关面板 |
| 筛选 | 全部 / 未解决 / 已解决 三段，切换只影响列表 |
| 列表项 | 头像 + 摘要 + 作者·时间·回复数；点一条跳到锚点并打开卡片（跳转后收起面板，窄面板里面板会盖住卡片） |
| 上一条 / 下一条 | `‹` `›` 在筛选后的列表里循环跳转 |
| 署名 | 面板底部输入框，回车保存到 `localStorage['github-md:comment-author']`；之后的批注用新名字与新首字母，已有批注保持原作者 |

**验收**：`gui-comments-check.mjs`（21/21）在真实应用里跑完整流程——打开文档触发 `/comments/load`、选中文字出现＋批注、
新建/回复/解决都落到侧车文件、正文出现高亮、刷新后圆点仍在、悬停高亮预览卡片、移开收起、点圆点重新打开卡片。
`gui-comments-panel-check.mjs`（12/12）覆盖面板：计数徽标、列表条数、三种筛选、上下条导航循环、署名持久化与新批注作者。

### 3.6 从 Word 导入批注（已实现：`src/comments/import.js` + `POST /github-md/comments/import`）

「Word ↔ markdown」的第一条通路：同名文件成对处理。

```
manuscript/results_Nov18.md        ← 正文（markdown）
manuscript/results_Nov18.docx      ← 同名 Word 文档，批注从这里读
manuscript/results_Nov18.comments.json  ← 侧车（导入后写入）
```

流程：读 docx（`readDocxComments`）→ 转成侧车模型（`fromDocxComments`）→ 把 docx 摊平文本上的偏移映射到 markdown
（`mapDocxAnchorsToMarkdown`：先按 quote 精确找，找不到再按段落近似）→ 与已有侧车 `mergeStores` 合并 →
原子写回。**幂等**：同一份 docx 导入两次不会产生重复批注（按 durableId 派生的 id 对齐）。

面板底部的「从 Word 导入」按钮触发；返回统计会以 toast 显示「已从 Word 导入 N 条批注（M 条锚点丢失）」，
找不到同名 docx 时提示「没有找到同名 .docx」。

**验收**：

| 脚本 | 覆盖 | 结果 |
| --- | --- | --- |
| `comments-import-test.mjs` | 真实 docx 46 条批注全部导入、23 条线程、映射 42 精确 / 4 空锚点、作者保留、与本地批注合并、重复导入幂等 | **10/10** |
| `gui-comments-import-check.mjs` | 真实应用里点「从 Word 导入」：docx 的根批注 + 回复进入侧车、已解决状态与作者保留、本地批注不丢、正文出现高亮 | **11/11** |

## 4. 与 Word 互操作## 4. 与 Word 互操作

- **导入**：解包 docx → 解析 5 个部件 → 把 `commentRangeStart/End` 映射到正文纯文本偏移 → 写 comments.json；
- **导出**：comments.json → comments.xml / commentsExtended.xml / commentsIds.xml / commentsExtensible.xml / people.xml，
  并在 document.xml 对应位置插 `commentRangeStart/End` + `commentReference` run，补 rels、`[Content_Types]`、`w:compat`;
- **验收**：导出的 docx 用 Word 打开，`doc.Comments.Count`、作者、时间、`Done`、`Ancestor` 与源一致（COM 读回，不靠肉眼）。

## 5. 多用户

- 身份：DSH 配置里的作者名/邮箱/首字母，颜色 = 名字 hash → 固定色板；
- 合并：git 友好，按 `id` 合并；同 id 取 `modifiedAt` 新者；回复按其 id 追加；
- 冲突：同一段被两人同时加批注 → 都保留（Word 也是这样）。

## 6. 测试计划

| 测试 | 断言 |
| --- | --- |
| `unit-comments-roundtrip` | comments.json ↔ docx 五个部件往返，字段不丢 |
| `unit-anchor-resolve` | 编辑前后锚点重定位；删光文字 → 标记为空锚点 |
| `gui-comments-create` | 选中文字 → 右侧出现卡片，作者/时间/正文正确 |
| `gui-comments-reply-resolve` | 回复缩进；解决后变灰并可重新打开 |
| `gui-comments-hover` | 正文 ↔ 卡片双向高亮 |
| `comments-test.mjs`（已实现） | 4 份真实 docx：条数 = Word COM 计数、线程/回复、done、作者、日期（本地 vs UTC）、durableId、锚点原文全部对上（27/27） |
| `comments-export-test.mjs`（已实现） | 导出 3 条批注后读回，字段全对；重复导出幂等（26/26） |
| `comments-word-check.mjs`（已实现） | 导出结果交给 Word COM 验收：条数/作者/锚点/线程/已解决（6/6） |
| `comments-model-test.mjs`（已实现） | 侧车 JSON、锚点重定位、线程/解决/删除墓碑、多用户合并、docx 互通（32/32） |
| `comments-model-word-check.mjs`（已实现） | model → 侧车 → docx → Word 读回，线程/已解决/锚点/作者全对（5/5） |
| `gui-comments-check.mjs`（已实现） | 真实应用里的批注 UI：新建、回复、解决、刷新持久化、悬停预览、圆点开关（21/21） |
| `gui-comments-panel-check.mjs`（已实现） | 批注面板：计数、三种筛选、上下条导航、署名持久化并用于新批注（12/12） |
| `comments-import-test.mjs`（已实现） | docx → 侧车导入：46 条、线程、映射统计、与本地合并、幂等（10/10） |
| `gui-comments-import-check.mjs`（已实现） | 应用内「从 Word 导入」按钮：批注/线程/已解决/作者/高亮全对（11/11） |
| `comments-jspace-roundtrip.mjs`（已实现） | 真实投稿稿件往返：22 条 / 11 线程 / 3 已解决，Word 对原文件与写回文件报告同样的 22 条、6 个 Done 段、22 个可解析锚点（6/6） |
| `word-import-real` | `JSpace_Liu_Oct09_2026.docx` 导入批注数 = COM 读到的 Count |
| `word-export-open` | 我们导出的 docx 用 Word 打开，评论数/线程/解决状态一致 |

## 7. 待验证

- @提及的存储（`w:comment` 里的 hyperlink？`w15:mention`？）
- `cr:reactions`（批注表情回应）的结构
- 图片、表格、脚注里的批注锚点
- 修订（track changes）与批注同时存在时的 `w:ins/w:del` 包裹方式
- 现代批注窗格的精确视觉（截图中经典卡片已拿到；现代窗格需要在 compatibilityMode 15 的新文档里再截一次）
