pages_new/create-app/start.html 创建应用的页面模块，我也不知道怎么做，但大概是：
- 告知用户创建应用需要先选择创建到哪里
- 是创建到虚拟系统内，还是选择真的系统的文件夹
- 使用的是 nonos-core 的文件系统，如果是选择真实系统，则使用 open  打开文件夹；如果是虚拟系统，则让用户填写应用名。
- 判断系统是否支持 open，有个api判断的，你查看一下 nonos-core 的文档。如果不支持open，则将选择本地目录的按钮 disabled，并且小文字提醒当前浏览器不支持选择本地文件目录。
- 选择完后，使用 pages/create-app/util/init-code.js 初始化应用代码。
- 初始化完成后，跳到 pages_new/create-app/create.html
