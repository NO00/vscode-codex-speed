# 插件图标设计记录

## 最终方案

用户指定以 GPT 的六瓣交织结形为基础向外舒展，中央加入小闪电。最终采用深海军蓝背景、冰白色向外展开的结形和薄荷绿闪电。没有使用用户头像。

使用内置 imagegen 生成工具，未调用备用 CLI 或用户 API 密钥。图标源图通过确定性降采样生成 256×256 PNG，保存为 `assets/icon.png`，并由 `package.json` 的 `icon` 字段引用。原始生成图保持不变。

`bash scripts/tools/prepare-icon.sh <源图路径>` 可重新生成安装包尺寸的图标。图标不代表 OpenAI 官方认可，市场说明明确标注为独立社区扩展。

## 最终生成提示词

以下保留调用内置工具时的完整提示词，便于追溯：

```text
Design a new square software extension logo for VSCode Codex Speed, following this exact visual direction: use the familiar ChatGPT / GPT sixfold interwoven knot-flower as the starting visual motif, then open and expand its six woven loops radially outward to leave a generous, clearly empty circular center. Add ONE small clean lightning bolt in that center, signaling fast token generation. The six outward-opening curved ribbon loops must still read as a precise elegant sixfold GPT-style woven knot, not a gear, a sun, a pinwheel or a generic flower. Keep each of the six ribbon loops broad, sculpturally simple, smoothly curved, evenly spaced and rotationally symmetric; convey a controlled opening-out motion with added breathing room between the loops. The centered lightning bolt should be compact, balanced and visibly separate from the loops, occupying about 16 percent of the canvas width; do not add an ECG line as well. Color direction: full-canvas solid midnight-navy background #101B2E, six white to very pale ice-cyan loops, a single vivid mint green #65F5C1 lightning bolt. Flat clean vector-style raster logo, crisp edges, even ribbon widths, bold silhouette, high contrast at 32 and 128 pixels. Center the complete emblem on a square canvas; total outer diameter about 76 percent of canvas. No text, no words, no letters, no numbers, no code brackets, no speedometer, no extra symbols, no decorative dots, no gradients, no glow, no shadows, no 3D rendering, no product mockup, no watermark. Just the finished centered icon artwork, 1024 by 1024 square.
```
