# 国旗图标

来自 [flag-icons](https://github.com/lipis/flag-icons) v7.5.0 的 `flags/1x1/` 目录
(正方形版本),MIT 许可(见上游 LICENSE,版权 © 2013 Panayiotis Lipiridis)。

只挑了 `src/lib/countries.ts` 里列出的那些国家/地区,没有整包引入:整包 271 个国旗
约 1.1MB,而这里只需要机场订阅里真正会出现的那几十个。文件按需加载(Vite 把它们
处理成独立资源,浏览器只取界面上真正显示到的那几个),所以列表长一点也不会拖慢首屏。

要新增一个国家:把上游 `flags/1x1/<code>.svg` 复制进来,再在 countries.ts 里加一行。
