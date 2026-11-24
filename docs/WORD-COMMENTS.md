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

### 1.8 读取实现与实测校验 **[实测]**

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
| 1 | 新建批注 | 选中文字 → 右键「新建批注」/ `Ctrl+Alt+M`；未选中时批注锚定到光标处的 **0 长度位置**（插入点） | 同左；空锚点要能在正文里渲染成一个小标记 |
| 2 | 批注范围 | 高亮被批注文字；范围随编辑移动，删光了变「空锚点」 | 锚点用 quote+偏移双保险，删光时保留标记并提示 |
| 3 | 悬停 | 鼠标悬停正文高亮处/标记 → 对应批注卡片高亮；悬停卡片 → 正文范围高亮 | 双向 hover 联动 |
| 4 | 卡片位置 | 右侧页边距，垂直对齐锚点所在行；多条重叠时堆叠 | 右侧 gutter，按锚点 y 排序、重叠时错开 |
| 5 | 卡片内容 | 头像（首字母）、作者名、时间（`2026年5月20日 15:40`）、正文、底部「答复」输入框、「解决」「…」菜单 | 同左，时间格式按 UI 语言 |
| 6 | 回复 | 卡片底部输入框回车即可，回复缩进挂在父批注下；电话/网页版支持 @提及 | 二级回复 + 名字首字母头像 |
| 7 | 解决 | 「解决」按钮 → 卡片变灰、加勾；「重新打开」可恢复；已解决默认仍显示（可筛选） | 同左，`done` 状态入 comments.json |
| 8 | 编辑 | 点正文进入编辑态，可改自己的内容；他人批注只读（除非有权限） | 编辑保留 `modifiedAt` |
| 9 | 删除 | 「…」→ 删除，删除后正文标记消失（线程随父批注一起删） | 删除父批注时级联 |
| 10 | 窗格 | 「审阅 → 批注」打开右侧批注列表；「显示批注」开关；上一条/下一条导航 | 侧栏列表 + 跳转 |
| 11 | 排序/筛选 | 按文档位置排序，可按「所有/已解决/我的」筛选 | 同左 |
| 12 | 打印 | 批注可打印在页边距（经典形态），现代默认不打印 | 先不做打印 |
| 13 | 复制粘贴 | 复制带批注的文字，批注一起复制；粘贴到别的文档锚点跟着来 | 后续支持 |
| 14 | 多作者 | 每个作者一个头像色；`people.xml` 存身份；同一段可挂多条批注 | 多用户、每用户颜色 |
| 15 | 协同 | 云端共编时批注实时出现，durableId 保证不重复 | 用文件监听 + id 合并实现"准实时" |
| 16 | 只读 | 只读文档可看批注不能改 | 权限开关 |

## 3. markdown 侧的数据模型（本开发线的设计）

正文不能塞 XML 标记（会污染纯文本、破坏 Obsidian 兼容），所以批注落在**侧车文件**：

```
manuscript/results_Nov18.md
manuscript/results_Nov18.comments.json
```

```json
{
  "version": 1,
  "documentHash": "sha256:…",
  "comments": [
    {
      "id": "c_37B0C978",
      "paraId": "61B8BC36",
      "durableId": "37B0C978",
      "parentId": null,
      "resolved": false,
      "author": { "name": "haoyunzhang", "initials": "hZ", "email": "haoyunzhang@um.edu.mo", "color": "#8b6cef" },
      "createdAt": "2026-05-20T15:40:00Z",
      "modifiedAt": "2026-05-20T15:40:00Z",
      "body": "Do we have the right to make it publicly available?\n\nThere is nothing there now.",
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

锚点策略（W3C Web Annotation 的组合选择器）：

1. 快速路径：`start/end` 偏移 + `quote` 校验命中；
2. 失效回退：在全文中找 `quote`，用 `prefix/suffix` 消歧；
3. 仍找不到 → 标记为「空锚点/已丢失」，在侧栏置顶提示，不静默丢失。

## 4. 与 Word 互操作

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
| `word-import-real` | `JSpace_Liu_Oct09_2026.docx` 导入批注数 = COM 读到的 Count |
| `word-export-open` | 我们导出的 docx 用 Word 打开，评论数/线程/解决状态一致 |

## 7. 待验证

- @提及的存储（`w:comment` 里的 hyperlink？`w15:mention`？）
- `cr:reactions`（批注表情回应）的结构
- 图片、表格、脚注里的批注锚点
- 修订（track changes）与批注同时存在时的 `w:ins/w:del` 包裹方式
- 现代批注窗格的精确视觉（截图中经典卡片已拿到；现代窗格需要在 compatibilityMode 15 的新文档里再截一次）
