# 通用图标

来自 [Twemoji](https://github.com/jdecked/twemoji) v15(`assets/svg/`),图形部分
CC-BY 4.0(版权 © Twitter, Inc and other contributors),过 svgo 压过一遍。

用途:策略/节点组的图标选择器里「其他」那一栏——交通、运动、花草、建筑、家居、
人物性别、办公杂物这些。国旗和公司标识之外,总有些组只是想要一个一眼认得出的记号。

和 globes/ 一样是 SVG 文件而不是 emoji 字体:面板里带的两份 emoji 字体都是只含国旗
的裁剪版,其余 emoji 会落到系统字体上,三个平台画出来的东西差别很大。

文件按需加载(见 vite.config.ts 的 assetsInlineLimit:这个目录和 flags/ 一样不内联),
浏览器只取界面上真正显示到的那几个。要增删就改这里的文件 + src/constant/misc-icons.ts。
