# 向量数据库学习笔记

> 基于 [altor-vec](index.html) 示例，从零理解向量数据库的核心概念。

---

## 1. 核心思路：文字变成数学，用数学找相似

传统数据库（如 MySQL）用 SQL 精确匹配：`WHERE title = '机器学习'`。  
向量数据库把文本转成**数字数组**（向量），然后**算数学距离**来找到"意思相近"的内容。

**关键转变**：从"精确匹配"到"语义相似度计算"。

---

## 2. 五个关键步骤

### ① 初始化：加载引擎 + 加载模型

```js
// 1. 加载 WASM 引擎（altor-vec 的 HNSW 搜索内核，54KB）
await init();

// 2. 加载嵌入模型（把文字变成向量的"翻译官"）
extractor = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2");
```

**为什么需要两个东西？**  
- 嵌入模型 = 翻译官，把文字翻译成向量（数字数组）  
- 搜索引擎 = 计算器，用向量算相似度、排序、返回结果

**位置**：[index.html](index.html#L247-L255)

---

### ② 字符串 → 向量数组（嵌入）

```js
async function embed(text) {
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(out.data);  // → 384 个浮点数组成的数组
}
```

**发生了什么？**  
`"机器学习是人工智能的一个分支……"` 这个字符串，经过模型处理后，变成了一个 **384 维的 Float32Array**，里面是 384 个小数（如 `[0.021, -0.015, 0.087, ...]`）。

**关键点**：  
- 相同语义的文字，生成的向量在空间中"距离近"  
- 不同语义的文字，向量"距离远"  
- 384 维是这只模型的能力，不同模型维度不同（1536、1024 等）

**位置**：[index.html](index.html#L161-L166)

---

### ③ 存入索引（建库）

```js
// 把所有文档的向量拼成一个扁平数组
const flat = new Float32Array(documents.length * DIM);
for (let i = 0; i < documents.length; i++) {
  const vec = await embed(doc.title + " " + doc.content);
  flat.set(vec, i * DIM);   // 第 i 个文档的向量，放在第 i 段
  idMap.push(doc);          // 记下 nodeId i 对应哪个文档
}

// 一次建索引
engine = WasmSearchEngine.from_vectors(flat, DIM, M, EF_CONSTRUCTION, EF_SEARCH);
```

**通俗理解**：  
把所有文档向量塞进一个"搜索结构"（HNSW 图）。这个结构建好后，可以快速找到"离某向量最近的 N 个向量"。

**注意**：altor-vec 不存文档本身的文字，只存向量。所以文档的原文（标题/内容/分类）要自己另存一份（`idMap` 数组），按插入顺序一一对应。

**位置**：[index.html](index.html#L169-L183)

---

### ④ 搜索（查询）

```js
// 1. 把用户查询也变成向量
const queryVec = await embed("人工智能");

// 2. 去索引里找最近的 N 个邻居
const raw = JSON.parse(engine.search(queryVec, 5));
// → [[nodeId, distance], [nodeId, distance], ...]

// 3. 把 nodeId 还原成文档
const results = raw.map(([nodeId, distance]) => ({
  doc: idMap[nodeId],       // 用之前存的映射找回原文
  distance,
  similarity: 1 - distance, // 距离越小越相似
}));
```

**三步曲**：  
1. 查询文本 → 向量（和建库时用同一个模型）  
2. 向量 → 去索引里找最近的 N 个  
3. nodeId → 还原成文档信息

**关键理解**：搜索过程 = 查向量 + 算距离 + 排序取 topN。没有 SQL 里的 `WHERE`，只有"哪个离我最近"。

**位置**：[index.html](index.html#L195-L218)

---

### ⑤ 持久化（保存/加载，避免每次重新嵌入）

```js
// 保存：序列化索引为二进制 + 存元数据
const bytes = engine.to_bytes();     // 索引 → Uint8Array
await set(KEY_INDEX, bytes);          // 存到 IndexedDB
await set(KEY_META, idMap);           // 文档映射也要存

// 加载：从二进制恢复索引
engine = new WasmSearchEngine(new Uint8Array(savedIndex));
idMap = savedMeta;                     // 恢复文档映射
```

**为什么需要持久化？**  
嵌入模型有 ~100MB，每次生成嵌入也要几秒。如果每次刷新页面都重新嵌入，体验很差。  
把建好的索引（序列化后通常是几 KB 到几十 MB）存到 IndexedDB，下次打开直接加载，秒级恢复。

**altor-vec 的策略**：自己管序列化，自己存。  
**对比 VecLite**：内置 IndexedDBAdapter，自动存。

**位置**：[index.html](index.html#L270-L281)

---

## 3. 向量数据库 vs 传统数据库

| | 传统数据库 | 向量数据库 |
|---|---|---|
| 查询方式 | `WHERE title = '机器学习'` | 查向量，找最近邻居 |
| 匹配方式 | 精确匹配 / 正则 / 全文索引 | 余弦相似度 / 欧氏距离 |
| 前提 | 数据直接存 | 数据要先过嵌入模型变向量 |
| 结果 | 完全匹配的记录 | 最相似的 N 个（按分数排序） |
| 适合场景 | 账户、订单、精确查找 | 搜索推荐、语义匹配、RAG |

---

## 4. 为什么是 HNSW？

HNSW = Hierarchical Navigable Small World（分层可导航小世界图）。

**直觉理解**：  
- 底层：所有向量都在，可以精确找最近邻（但慢）  
- 上层：只有部分"代表向量"，像高速公路，先快速定位到大概区域  
- 搜索时：从顶层 → 往下层，像"先看地图找城市 → 再找具体街道"  

**结果**：O(log n) 而不是 O(n)，1 万个向量里找邻居只需 0.6ms。

---

## 5. 初学者的常见疑问

### Q: 为什么是 384 维？不是越多越好吗？
不同模型输出的维度不同：  
- `all-MiniLM-L6-v2` → 384 维（轻量，浏览器友好）  
- `text-embedding-3-small` → 1536 维（OpenAI 的，更准但更大）  
- 维度越高，信息越丰富，但计算越慢，存储越大

### Q: 相似度有什么用？
- 0.95 = 几乎同一件事  
- 0.7-0.8 = 相关主题  
- 0.3-0.5 = 弱相关  
- < 0.2 = 基本无关

### Q: nodeId 是什么？
altor-vec 内部用 0、1、2、3… 编号向量。你插入的第 i 个向量，nodeId 就是 i。  
所以建库时一定要维护一个 `idMap[i] = 文档` 的映射，否则搜到结果也不知道是哪个文档。

### Q: 为什么 altor-vec 不存 metadata？
为了最小体积（54KB）。存 metadata 意味着要序列化 JSON/对象，增加 WASM 体积和复杂度。  
VecLite 存了，所以它 60KB+17KB。这是设计取舍：**功能越少，体积越小**。

---

## 6. 总结流程图

```
用户输入 "人工智能"
        ↓
  嵌入模型（transformers.js）
        ↓
  向量 [0.021, -0.015, 0.087, ...]  (384 个浮点数)
        ↓
  engine.search(queryVec, 5)  → 在 HNSW 图里找最近邻居
        ↓
  [[3, 0.12], [1, 0.18], ...]  (nodeId + 距离)
        ↓
  idMap[3] → "自然语言处理技术"
  idMap[1] → "机器学习基础"
```

**三条红线**：  
1. 建库时用 `extractor` 嵌入 → 查询时也要用**同一个模型**嵌入  
2. 插入顺序 = nodeId → 必须维护 `idMap` 映射  
3. 向量数据库只管向量 → 原文/元数据自己存

---

## 7. 如何配置召回率

### 7.1 什么是召回率（Recall）

召回率衡量 HNSW 近似搜索的"准确度"：

```
Recall@k = HNSW 返回的 topK 中，真正属于"暴力精确 topK"的比例
```

- **100%** = 和暴力扫描结果完全一致  
- **95%** = 偶尔漏了一个真正最相似的  
- HNSW 是**近似算法**，用"牺牲一点点精度"换来"快几十上百倍"  
- 和暴力精确搜索不是完全对立，而是**用精度换速度**，而且你可以通过调参让召回率无限接近 100%

### 7.2 三个参数如何影响召回

altor-vec 的 `from_vectors` 接受了三个 HNSW 参数：

```js
engine = WasmSearchEngine.from_vectors(flat, DIM,  M, efConstruction, efSearch);
//                                                   ↑      ↑             ↑
//                                                  连接数  建库宽度     搜索宽度
```

#### M（连接数，默认 16）

| M | 召回影响 | 其他影响 |
|---|---|---|
| 8 | 降，图太稀疏 | 内存小，建库快 |
| 16 | 基准（默认） | 平衡 |
| 32 | 升，图更密 | 内存翻倍，建库变慢 |
| 48 | 继续升，接近饱和 | 内存更大，收益递减 |

**规律**：M 翻倍，内存 ≈ 翻倍（因为每条边都要存）。M > 32 后召回提升越来越小。

#### efConstruction（建库宽度，默认 200）

| 值 | 召回影响 | 建库时间 |
|---|---|---|
| 100 | 稍降 | 快 |
| 200 | 基准（默认） | 适中 |
| 400 | 略升 | 更慢 |
| 800+ | 几乎无提升 | 慢很多 |

**规律**：efConstruction 只影响**建库质量**，不影响搜索速度。200 已经够好，不太需要调大。

#### efSearch（搜索宽度，默认 50）← 最重要的旋钮

| efSearch | 召回率（估计） | 搜索耗时 |
|---|---|---|
| 10 | ~80% | 极快 |
| 50 | ~95-99%（默认） | 基准 |
| 100 | ~99%+ | 约 2x 基准 |
| 200 | ~99.9% | 约 4x 基准 |
| 1000 | ≈100% | 约 20x 基准（≈暴力扫描） |

**规律**：efSearch 越大，搜索越接近精确，但代价是线性变慢。**这是日常调参最常用的参数**：数据量大时，想更快就降低 efSearch，想更准就提高它。

### 7.3 三个参数的总结

| 参数 | 影响对象 | 调参时机 | 代价 |
|---|---|---|---|
| `M` | 建库 | 一开始决定，建完不能改 | 内存 |
| `efConstruction` | 建库 | 建库时定，不改也行 | 建库时间 |
| `efSearch` | **搜索** | **每次搜索可调** | 搜索时间 |

**最实用的调参策略**：
- M 和 efConstruction 用默认值，**不用管**  
- 如果搜索太慢 → 降低 `efSearch`  
- 如果召回不够 → 提高 `efSearch`

### 7.4 代码中如何调参

在 [index.html](index.html#L156-L158) 中，它们被定义在开头：

```js
const M = 16;               // 每个节点连接数
const EF_CONSTRUCTION = 200; // 建库宽度
const EF_SEARCH = 50;        // 搜索宽度（默认搜索时用，但 altor-vec 是建库时固定）
```

注意：altor-vec 的 `efSearch` 是**在建库时固定**的（`from_vectors` 的第 5 个参数），不能像其他库（如 hnswlib-wasm）那样在搜索时动态改。这就是 altor-vec 为了体积做的简化。

### 7.5 那条"召回率 vs 速度"曲线

```
召回率%
 100 │          ●────────────→ 接近精确（efSearch很大）
  95 │     ●
  90 │   ●
  80 │ ●
     └──────────────────→ 搜索耗时
        快              慢
```

**关键认识**：在 efSearch=50 时（95-99%），你已经用 0.6ms 获得了接近精确的结果。要提高到 99.9%，速度会慢 4 倍（约 2.4ms），对大多数场景来说不值。**默认值就是最好的平衡点。**

### 7.6 不同规模下的注意事项

| 数据量 | 召回率表现 | 建议 |
|---|---|---|
| < 1,000 | ≈100%（HNSW 还没开始"近似"） | 啥也不用调 |
| 1,000 ~ 10,000 | 默认 99%+ | 默认值即可 |
| 10,000 ~ 100,000 | 默认 95-99% | 可调 efSearch 平衡 |
| > 100,000 | 可能降到 90-95% | 适当提高 M 和 efSearch |

### 7.7 想精确验证召回率怎么做

在数据量大时（比如几万条），同时跑一遍**暴力全量余弦相似度**当作"标准答案"，再对比 HNSW 的 topK 结果：

```js
// 伪代码
function bruteForceSearch(queryVec, topK, allVectors) {
  const scores = allVectors.map(v => cosineSimilarity(queryVec, v));
  return scores
    .map((s, i) => [i, s])
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);
}

const exact = bruteForceSearch(queryVec, 10, allVectors);
const ann = JSON.parse(engine.search(queryVec, 10));

// 对比前 10 的交集
const exactIds = new Set(exact.map(([id]) => id));
const hitCount = ann.filter(([id]) => exactIds.has(id)).length;
const recall = hitCount / 10;  // Recall@10
```

你之前的 [others/vector-retrieval](file:///Users/yao/Documents/GitHub/Mazmot/others/vector-retrieval) 里那套暴力扫描正好可以拿来当基准做对比。