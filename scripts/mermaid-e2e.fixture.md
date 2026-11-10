Mermaid e2e fixture.

1. Bold labels (reported case):

```mermaid
flowchart TD
    A["UI 编辑需求输入"] --> B{"需求性质判定"}
    B -->|"局部精修<br>改文案 / 调品牌色"| C["第 1 层: 本地 DOM 精修<br><b>消耗 0 次 Stitch 配额 · 2 秒</b>"]
    B -->|"结构重构<br>多方案变体"| D["第 1 层: Stitch 云端 variants<br><b>每屏 1-3 次配额 · 45-90 秒</b>"]
```

2. Unlabelled fence:

```
sequenceDiagram
    Agent->>Paseo: assistant message
    Paseo-->>Vec: rendered diagram
```

3. Blocked shape metadata:

```mermaid
flowchart LR
    A["start"] --> B@{ shape: rect, label: "shape data" }
```

4. Syntax error:

```mermaid
flowchart TD
    A[open (paren] --> B
```
