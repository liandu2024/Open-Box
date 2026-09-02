// 通用图标目录。策略、节点组的图标选择器里「其他」那一栏就是这张表:
// 交通、运动、花草、建筑、家居、人物性别、办公杂物——国旗和公司标识之外,总有些组
// 只是想要一个一眼认得出的记号。
//
// 图形是 Twemoji v15 的彩色 emoji,文件在 src/assets/misc/(CC-BY 4.0,见那边的
// README)。这里只存有哪些、叫什么、怎么搜,图形本身由浏览器按需去取。
// zh/en 与 keywords 一起参与搜索:输「汽车」「car」「车」都该找到同一个。
export interface MiscIcon {
  id: string
  zh: string
  en: string
  keywords: string[]
}

export const MISC_ICONS: MiscIcon[] = [
  { id: 'direct', zh: '直连', en: 'Direct', keywords: ['direct', '直连', '直通', '高速公路'] },
  { id: 'reject', zh: '拒绝', en: 'Reject', keywords: ['reject', 'block', '拒绝', '拦截', '禁止'] },
  { id: 'car', zh: '汽车', en: 'Car', keywords: ['car', '汽车', '轿车', '车'] },
  { id: 'taxi', zh: '出租车', en: 'Taxi', keywords: ['taxi', '出租车', '打车'] },
  { id: 'bus', zh: '公交车', en: 'Bus', keywords: ['bus', '公交', '巴士'] },
  { id: 'train', zh: '火车', en: 'Train', keywords: ['train', '火车', '高铁', '铁路'] },
  { id: 'metro', zh: '地铁', en: 'Metro', keywords: ['metro', 'subway', '地铁'] },
  { id: 'plane', zh: '飞机', en: 'Airplane', keywords: ['plane', '飞机', '航班', '机票'] },
  { id: 'ship', zh: '轮船', en: 'Ship', keywords: ['ship', '轮船', '船', '航运'] },
  { id: 'bike', zh: '自行车', en: 'Bicycle', keywords: ['bike', '自行车', '单车'] },
  { id: 'motorcycle', zh: '摩托车', en: 'Motorcycle', keywords: ['motorcycle', '摩托', '机车'] },
  { id: 'rocket', zh: '火箭', en: 'Rocket', keywords: ['rocket', '火箭', '加速'] },
  { id: 'soccer', zh: '足球', en: 'Soccer', keywords: ['soccer', 'football', '足球', '运动'] },
  { id: 'basketball', zh: '篮球', en: 'Basketball', keywords: ['basketball', '篮球', '运动'] },
  { id: 'tennis', zh: '网球', en: 'Tennis', keywords: ['tennis', '网球', '运动'] },
  { id: 'swim', zh: '游泳', en: 'Swimming', keywords: ['swim', '游泳', '运动'] },
  { id: 'run', zh: '跑步', en: 'Running', keywords: ['run', '跑步', '运动'] },
  { id: 'gym', zh: '健身', en: 'Weightlifting', keywords: ['gym', '健身', '举重', '运动'] },
  { id: 'trophy', zh: '奖杯', en: 'Trophy', keywords: ['trophy', '奖杯', '冠军', '比赛'] },
  { id: 'game', zh: '游戏', en: 'Game', keywords: ['game', '游戏', '手柄'] },
  { id: 'dart', zh: '飞镖', en: 'Dart', keywords: ['dart', '飞镖', '目标', '精准'] },
  { id: 'chess', zh: '棋', en: 'Chess', keywords: ['chess', '棋', '国际象棋'] },
  { id: 'flower', zh: '花', en: 'Flower', keywords: ['flower', '花', '樱花', '植物'] },
  { id: 'rose', zh: '玫瑰', en: 'Rose', keywords: ['rose', '玫瑰', '花'] },
  { id: 'tree', zh: '树', en: 'Tree', keywords: ['tree', '树', '森林', '植物'] },
  { id: 'leaf', zh: '叶子', en: 'Leaf', keywords: ['leaf', '叶子', '植物', '绿色'] },
  { id: 'cactus', zh: '仙人掌', en: 'Cactus', keywords: ['cactus', '仙人掌', '植物'] },
  { id: 'seedling', zh: '幼苗', en: 'Seedling', keywords: ['seedling', '幼苗', '发芽', '植物'] },
  { id: 'sun', zh: '太阳', en: 'Sun', keywords: ['sun', '太阳', '晴天', '天气'] },
  { id: 'moon', zh: '月亮', en: 'Moon', keywords: ['moon', '月亮', '夜晚'] },
  { id: 'star', zh: '星星', en: 'Star', keywords: ['star', '星星', '收藏'] },
  { id: 'rainbow', zh: '彩虹', en: 'Rainbow', keywords: ['rainbow', '彩虹'] },
  { id: 'fire', zh: '火', en: 'Fire', keywords: ['fire', '火', '热门'] },
  { id: 'water', zh: '水滴', en: 'Droplet', keywords: ['water', '水', '水滴'] },
  { id: 'snow', zh: '雪花', en: 'Snowflake', keywords: ['snow', '雪', '雪花', '冬天'] },
  { id: 'cloud', zh: '云', en: 'Cloud', keywords: ['cloud', '云', '云朵', '天气'] },
  { id: 'mountain', zh: '山', en: 'Mountain', keywords: ['mountain', '山', '高山'] },
  { id: 'home', zh: '家', en: 'Home', keywords: ['home', '家', '住宅', '房子'] },
  { id: 'office', zh: '写字楼', en: 'Office', keywords: ['office', '写字楼', '办公', '公司'] },
  { id: 'school', zh: '学校', en: 'School', keywords: ['school', '学校', '教育'] },
  { id: 'hospital', zh: '医院', en: 'Hospital', keywords: ['hospital', '医院', '医疗'] },
  { id: 'bank', zh: '银行', en: 'Bank', keywords: ['bank', '银行', '金融'] },
  { id: 'hotel', zh: '酒店', en: 'Hotel', keywords: ['hotel', '酒店', '旅馆'] },
  { id: 'factory', zh: '工厂', en: 'Factory', keywords: ['factory', '工厂', '制造'] },
  { id: 'castle', zh: '城堡', en: 'Castle', keywords: ['castle', '城堡'] },
  { id: 'store', zh: '便利店', en: 'Store', keywords: ['store', '便利店', '商店', '购物'] },
  { id: 'city', zh: '城市', en: 'Cityscape', keywords: ['city', '城市', '都市'] },
  { id: 'phone', zh: '手机', en: 'Phone', keywords: ['phone', '手机', '移动'] },
  { id: 'laptop', zh: '笔记本', en: 'Laptop', keywords: ['laptop', '电脑', '笔记本'] },
  { id: 'tv', zh: '电视', en: 'TV', keywords: ['tv', '电视', '影视'] },
  { id: 'camera', zh: '相机', en: 'Camera', keywords: ['camera', '相机', '拍照'] },
  { id: 'headphone', zh: '耳机', en: 'Headphone', keywords: ['headphone', '耳机', '音乐'] },
  { id: 'book', zh: '书', en: 'Books', keywords: ['book', '书', '阅读', '学习'] },
  { id: 'mail', zh: '邮件', en: 'Mail', keywords: ['mail', '邮件', '信'] },
  { id: 'lock', zh: '锁', en: 'Lock', keywords: ['lock', '锁', '安全', '加密'] },
  { id: 'key', zh: '钥匙', en: 'Key', keywords: ['key', '钥匙', '密钥'] },
  { id: 'gear', zh: '齿轮', en: 'Gear', keywords: ['gear', '齿轮', '设置', '配置'] },
  { id: 'tool', zh: '扳手', en: 'Wrench', keywords: ['tool', '工具', '扳手', '维修'] },
  { id: 'chart', zh: '图表', en: 'Chart', keywords: ['chart', '图表', '统计', '数据'] },
  { id: 'clock', zh: '闹钟', en: 'Clock', keywords: ['clock', '时钟', '闹钟', '时间'] },
  { id: 'calendar', zh: '日历', en: 'Calendar', keywords: ['calendar', '日历', '日期'] },
  { id: 'folder', zh: '文件夹', en: 'Folder', keywords: ['folder', '文件夹', '目录'] },
  { id: 'pin', zh: '图钉', en: 'Pin', keywords: ['pin', '图钉', '置顶', '标记'] },
  { id: 'bulb', zh: '灯泡', en: 'Bulb', keywords: ['bulb', '灯泡', '想法', '创意'] },
  { id: 'battery', zh: '电池', en: 'Battery', keywords: ['battery', '电池', '电量'] },
  { id: 'satellite', zh: '卫星天线', en: 'Satellite', keywords: ['satellite', '卫星', '天线', '信号'] },
  { id: 'shield', zh: '盾牌', en: 'Shield', keywords: ['shield', '盾牌', '防护', '安全'] },
  { id: 'globe-net', zh: '网络', en: 'Globe with meridians', keywords: ['globe', '网络', '互联网', 'www'] },
  { id: 'link', zh: '链接', en: 'Link', keywords: ['link', '链接', '连接'] },
  { id: 'coffee', zh: '咖啡', en: 'Coffee', keywords: ['coffee', '咖啡'] },
  { id: 'tea', zh: '茶', en: 'Tea', keywords: ['tea', '茶', '茶饮'] },
  { id: 'burger', zh: '汉堡', en: 'Burger', keywords: ['burger', '汉堡', '快餐', '美食'] },
  { id: 'pizza', zh: '披萨', en: 'Pizza', keywords: ['pizza', '披萨', '美食'] },
  { id: 'cake', zh: '蛋糕', en: 'Cake', keywords: ['cake', '蛋糕', '生日'] },
  { id: 'beer', zh: '啤酒', en: 'Beer', keywords: ['beer', '啤酒', '酒'] },
  { id: 'cat', zh: '猫', en: 'Cat', keywords: ['cat', '猫', '宠物'] },
  { id: 'dog', zh: '狗', en: 'Dog', keywords: ['dog', '狗', '宠物'] },
  { id: 'panda', zh: '熊猫', en: 'Panda', keywords: ['panda', '熊猫'] },
  { id: 'fish', zh: '鱼', en: 'Fish', keywords: ['fish', '鱼'] },
  { id: 'bird', zh: '鸟', en: 'Bird', keywords: ['bird', '鸟'] },
  { id: 'man', zh: '男', en: 'Man', keywords: ['man', '男', '男性', '性别', 'gender', 'sex'] },
  { id: 'woman', zh: '女', en: 'Woman', keywords: ['woman', '女', '女性', '性别', 'gender', 'sex'] },
  { id: 'boy', zh: '男孩', en: 'Boy', keywords: ['boy', '男孩', '儿童', '孩子'] },
  { id: 'girl', zh: '女孩', en: 'Girl', keywords: ['girl', '女孩', '儿童', '孩子'] },
  { id: 'baby', zh: '婴儿', en: 'Baby', keywords: ['baby', '婴儿', '宝宝'] },
  { id: 'old-man', zh: '老人(男)', en: 'Old man', keywords: ['old', '老人', '爷爷', '长辈'] },
  { id: 'old-woman', zh: '老人(女)', en: 'Old woman', keywords: ['old', '老人', '奶奶', '长辈'] },
  { id: 'family', zh: '家庭', en: 'Family', keywords: ['family', '家庭', '一家'] },
  { id: 'male-sign', zh: '男性符号', en: 'Male sign', keywords: ['male', '男', '性别', '符号', 'gender', 'sex'] },
  { id: 'female-sign', zh: '女性符号', en: 'Female sign', keywords: ['female', '女', '性别', '符号', 'gender', 'sex'] },
  { id: 'heart', zh: '爱心', en: 'Heart', keywords: ['heart', '爱心', '喜欢', '收藏'] },
  { id: 'music', zh: '音乐', en: 'Music', keywords: ['music', '音乐', '歌曲'] },
  { id: 'film', zh: '电影', en: 'Film', keywords: ['film', '电影', '影视', '视频'] },
  { id: 'gift', zh: '礼物', en: 'Gift', keywords: ['gift', '礼物', '赠送'] },
  { id: 'money', zh: '钱袋', en: 'Money', keywords: ['money', '钱', '金钱', '财务'] },
  { id: 'cart', zh: '购物车', en: 'Cart', keywords: ['cart', '购物车', '购物', '电商'] },
  { id: 'briefcase', zh: '公文包', en: 'Briefcase', keywords: ['briefcase', '公文包', '工作', '商务'] },
  { id: 'medal', zh: '金牌', en: 'Medal', keywords: ['medal', '金牌', '第一', '奖'] },
  { id: 'checkered-flag', zh: '终点旗', en: 'Checkered flag', keywords: ['flag', '终点', '比赛', '完成'] },
  { id: 'warning', zh: '警告', en: 'Warning', keywords: ['warning', '警告', '注意', '提醒'] },
  { id: 'question', zh: '问号', en: 'Question', keywords: ['question', '问号', '疑问', '未知'] },
  { id: 'bell', zh: '铃铛', en: 'Bell', keywords: ['bell', '铃铛', '通知', '提醒'] },
  { id: 'label', zh: '标签', en: 'Label', keywords: ['label', '标签', 'tag', '分类'] },
  { id: 'package', zh: '包裹', en: 'Package', keywords: ['package', '包裹', '快递', '打包'] },
  { id: 'wrench-hammer', zh: '工具箱', en: 'Tools', keywords: ['tools', '工具', '维修'] },
  { id: 'magnifier', zh: '放大镜', en: 'Magnifier', keywords: ['search', '搜索', '放大镜', '查找'] },
]

// 图标值统一带前缀存,和国旗(HK)、地球(globe:asia)、公司(brand:google)区分开
export const MISC_PREFIX = 'misc:'

export const isMiscIcon = (value?: string): boolean => /^misc:/i.test(String(value || ''))

export const findMiscIcon = (value?: string): MiscIcon | undefined => {
  if (!isMiscIcon(value)) return undefined
  const id = String(value).slice(MISC_PREFIX.length).toLowerCase()
  return MISC_ICONS.find((i) => i.id === id)
}

export const miscIconName = (i: MiscIcon, locale: string): string => (locale.startsWith('zh') ? i.zh : i.en)
