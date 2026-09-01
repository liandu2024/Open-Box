'use strict';
'require view';
'require rpc';
'require ui';
'require fs';

// ---------------------------------------------------------------------------
// 自带翻译表
//
// 不用 LuCI 的 _():它查的是已加载的翻译目录,而我们的发布模型只铺文件、不走
// ipk 构建,拿不到 po2lmo 去编译 .po → .lmo。结果是只有恰好存在于 luci-base
// 目录里的串被翻译(Status/Stop/Restart/Emergency),自定义串全是英文,页面
// 中英混杂。这里自己查表,行为确定:简体、繁体各一份,其余语言一律英文。
// ---------------------------------------------------------------------------
var I18N = {
	'zh-Hans': {
		'Basic settings. Full management lives in the Open-Box panel:':
			'基本设置,完整管理请到 Open-Box 面板:',
		'sing-box core': 'sing-box 内核',
		'Open-Box panel': 'Open-Box 面板',
		'Open-Box upgrade': 'Open-Box 升级',
		'Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.':
			'停止会同时关闭开机自启(重启后不会自己跑起来),并恢复正常上网:IPv6 泄漏拦截与 Open-Box 写入的 DNS 上游都会被移除。面板仍然可以访问。',
		'Autostart': '开机自启',
		'running': '运行中',
		'stopped': '已停止',
		'on': '开',
		'off': '关',
		'Start': '启动',
		'Stop': '停止',
		'Restart': '重启',
		'Enable autostart': '开启自启',
		'Disable autostart': '关闭自启',
		'Check for updates': '检查更新',
		'Checking...': '检查中…',
		'Up to date.': '已是最新版本。',
		'New version available: %s': '有新版本:%s',
		'Could not check (network unreachable or blocked).': '无法检查(网络不通或被拦截)。',
		'Not installed': '未安装',
		'Action sent: %s %s': '已发送操作:%s %s',
		'Action failed: %s': '操作失败:%s',
		'init action failed': '服务操作未成功',
		'Update now': '立即更新',
		'Confirm update': '确认更新',
		'This will stop services and replace program files. The panel will be briefly unavailable. Continue?':
			'此操作会停止服务并替换程序文件,期间面板会短暂不可用。确定继续吗?',
		'GitHub direct': 'GitHub 直连',
		'Test all update channels': '一键检测可用升级渠道',
		'Test': '检测',
		'Testing...': '检测中…',
		'Not tested yet': '未检测',
		'Available %sms': '可用 %sms',
		'Unavailable': '不可用',
		'Updating to %s (%s)...': '正在更新到 %s(%s)…',
		'Starting update...': '正在启动更新…',
		'Update started. This may take a few minutes (about 80MB to download).':
			'更新已开始,可能需要几分钟(约需下载 80MB)。',
		'Update complete: now on %s.': '更新完成,当前版本:%s。',
		'Already up to date (no changes made).': '已是最新版本(未做任何改动)。',
		'Update timed out. It may still be running in the background; check again shortly.':
			'更新超时。它可能仍在后台运行,请稍后再检查一次。',
		'Update failed.': '更新失败。',
		'Update failed': '更新失败',
		'Update failed: %s': '更新失败:%s',
		'Update failed to start': '启动更新失败/无响应',
		'Update did not start. No response after 20 seconds — check the log below, or run the update over SSH instead: sh /opt/open-box/update.sh':
			'更新未能启动,20 秒内没有任何响应——请查看下方日志,或改用 SSH 手动执行:sh /opt/open-box/update.sh',
		'Update progress unavailable': '无法读取更新进度',
		'Cannot read update progress for this session. The update may still be running in the background — this usually means the LuCI session needs to log in again for newly granted permissions to take effect. You can also check directly over SSH: cat /tmp/openbox-update.status':
			'本次会话无法读取更新进度。更新可能仍在后台运行——这通常是因为需要重新登录 LuCI 让新授予的权限生效。也可以改用 SSH 直接查看:cat /tmp/openbox-update.status',
		'Recent update log:': '最近的更新日志:',
		'Update script not found. Run it manually over SSH.': '未找到升级脚本,请通过 SSH 手动执行。',
		'Preparing...': '正在准备…',
		'Probing channels...': '正在探测渠道…',
		'Downloading...': '正在下载…',
		'Verifying checksum...': '正在校验…',
		'Extracting...': '正在解包…',
		'Replacing program files (cannot cancel)...': '正在替换程序文件(无法取消)…',
		'Finishing...': '正在收尾…',
		'Update cancelled.': '更新已取消。',
		'Cancel update': '取消更新',
		'Cancelling...': '正在取消…',
		'Cancellation requested. The update will stop shortly.': '已请求取消,更新将很快停止。',
		'Already in the replacement stage; cannot cancel now.': '已进入替换阶段,无法取消。',
		'No update is currently running.': '当前没有正在运行的更新。',
		'Cancel request failed: %s': '取消请求失败:%s',
		'Past this point, cancelling is no longer possible.': '进入此阶段后将无法取消。',
		'Close': '关闭',
		'Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.':
			'从这台路由器上移除 Open-Box。服务会被停止,DNS 与防火墙改动会被还原,刷新后本页面也会消失。',
		'Uninstall Open-Box': '卸载 Open-Box',
		'Also delete data (subscriptions, password, rule sets)': '同时删除数据(订阅、密码、规则集)',
		'Keeping data lets a later re-install reuse it. Delete it for a completely fresh start.':
			'保留数据可供以后重新安装时复用;要彻底重来就勾选删除。',
		'This cannot be undone. Continue?': '此操作不可撤销,确定继续吗?',
		'Cancel': '取消',
		'Confirm uninstall': '确认卸载',
		'Uninstalling...': '正在卸载…',
		'Uninstalled. Refresh the page; this menu entry will be gone.': '已卸载。请刷新页面,本菜单项将会消失。',
		'Uninstall failed: %s': '卸载失败:%s',
		'Uninstall script not found. Run it manually over SSH.': '未找到卸载脚本,请通过 SSH 手动执行。'
	},
	'zh-Hant': {
		'Basic settings. Full management lives in the Open-Box panel:':
			'基本設定,完整管理請到 Open-Box 面板:',
		'sing-box core': 'sing-box 核心',
		'Open-Box panel': 'Open-Box 面板',
		'Open-Box upgrade': 'Open-Box 升級',
		'Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.':
			'停止會同時關閉開機自啟(重新啟動後不會自己執行),並恢復正常上網:IPv6 洩漏攔截與 Open-Box 寫入的 DNS 上游都會被移除。面板仍然可以存取。',
		'Autostart': '開機自啟',
		'running': '執行中',
		'stopped': '已停止',
		'on': '開',
		'off': '關',
		'Start': '啟動',
		'Stop': '停止',
		'Restart': '重新啟動',
		'Enable autostart': '開啟自啟',
		'Disable autostart': '關閉自啟',
		'Check for updates': '檢查更新',
		'Checking...': '檢查中…',
		'Up to date.': '已是最新版本。',
		'New version available: %s': '有新版本:%s',
		'Could not check (network unreachable or blocked).': '無法檢查(網路不通或被攔截)。',
		'Not installed': '未安裝',
		'Action sent: %s %s': '已傳送操作:%s %s',
		'Action failed: %s': '操作失敗:%s',
		'init action failed': '服務操作未成功',
		'Update now': '立即更新',
		'Confirm update': '確認更新',
		'This will stop services and replace program files. The panel will be briefly unavailable. Continue?':
			'此操作會停止服務並替換程式檔案,期間面板會短暫無法使用。確定要繼續嗎?',
		'GitHub direct': 'GitHub 直連',
		'Test all update channels': '一鍵檢測可用升級渠道',
		'Test': '檢測',
		'Testing...': '檢測中…',
		'Not tested yet': '未檢測',
		'Available %sms': '可用 %sms',
		'Unavailable': '不可用',
		'Updating to %s (%s)...': '正在更新到 %s(%s)…',
		'Starting update...': '正在啟動更新…',
		'Update started. This may take a few minutes (about 80MB to download).':
			'更新已開始,可能需要幾分鐘(約需下載 80MB)。',
		'Update complete: now on %s.': '更新完成,目前版本:%s。',
		'Already up to date (no changes made).': '已是最新版本(未做任何變更)。',
		'Update timed out. It may still be running in the background; check again shortly.':
			'更新逾時。它可能仍在背景執行,請稍後再檢查一次。',
		'Update failed.': '更新失敗。',
		'Update failed': '更新失敗',
		'Update failed: %s': '更新失敗:%s',
		'Update failed to start': '啟動更新失敗/無回應',
		'Update did not start. No response after 20 seconds — check the log below, or run the update over SSH instead: sh /opt/open-box/update.sh':
			'更新未能啟動,20 秒內沒有任何回應——請查看下方日誌,或改用 SSH 手動執行:sh /opt/open-box/update.sh',
		'Update progress unavailable': '無法讀取更新進度',
		'Cannot read update progress for this session. The update may still be running in the background — this usually means the LuCI session needs to log in again for newly granted permissions to take effect. You can also check directly over SSH: cat /tmp/openbox-update.status':
			'本次工作階段無法讀取更新進度。更新可能仍在背景執行——這通常是因為需要重新登入 LuCI 讓新授予的權限生效。也可以改用 SSH 直接檢視:cat /tmp/openbox-update.status',
		'Recent update log:': '最近的更新日誌:',
		'Update script not found. Run it manually over SSH.': '找不到升級腳本,請透過 SSH 手動執行。',
		'Preparing...': '正在準備…',
		'Probing channels...': '正在探測渠道…',
		'Downloading...': '正在下載…',
		'Verifying checksum...': '正在校驗…',
		'Extracting...': '正在解壓…',
		'Replacing program files (cannot cancel)...': '正在替換程式檔案(無法取消)…',
		'Finishing...': '正在收尾…',
		'Update cancelled.': '更新已取消。',
		'Cancel update': '取消更新',
		'Cancelling...': '正在取消…',
		'Cancellation requested. The update will stop shortly.': '已請求取消,更新將很快停止。',
		'Already in the replacement stage; cannot cancel now.': '已進入替換階段,無法取消。',
		'No update is currently running.': '目前沒有正在執行的更新。',
		'Cancel request failed: %s': '取消請求失敗:%s',
		'Past this point, cancelling is no longer possible.': '進入此階段後將無法取消。',
		'Close': '關閉',
		'Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.':
			'從這台路由器上移除 Open-Box。服務會被停止,DNS 與防火牆變更會被還原,重新整理後本頁面也會消失。',
		'Uninstall Open-Box': '解除安裝 Open-Box',
		'Also delete data (subscriptions, password, rule sets)': '同時刪除資料(訂閱、密碼、規則集)',
		'Keeping data lets a later re-install reuse it. Delete it for a completely fresh start.':
			'保留資料可供日後重新安裝時沿用;要徹底重來就勾選刪除。',
		'This cannot be undone. Continue?': '此操作無法復原,確定要繼續嗎?',
		'Cancel': '取消',
		'Confirm uninstall': '確認解除安裝',
		'Uninstalling...': '正在解除安裝…',
		'Uninstalled. Refresh the page; this menu entry will be gone.': '已解除安裝。請重新整理頁面,本選單項目將會消失。',
		'Uninstall failed: %s': '解除安裝失敗:%s',
		'Uninstall script not found. Run it manually over SSH.': '找不到解除安裝腳本,請透過 SSH 手動執行。'
	}
};

// 跟随 OpenWrt 的系统语言;非中文一律回落英文。
function detectLang() {
	var raw = '';
	try { if (L && L.env && L.env.lang) raw = String(L.env.lang); } catch (e) { /* ignore */ }
	if (!raw || raw === 'auto') {
		try { raw = String(document.documentElement.lang || ''); } catch (e) { /* ignore */ }
	}
	if (!raw || raw === 'auto') {
		try { raw = String(navigator.language || ''); } catch (e) { /* ignore */ }
	}
	var v = raw.replace(/_/g, '-').toLowerCase();
	if (v.indexOf('zh') !== 0) return 'en';
	if (/hant|tw|hk|mo/.test(v)) return 'zh-Hant';
	return 'zh-Hans';
}

var LANG = detectLang();

function tr(s) {
	var table = I18N[LANG];
	return (table && table[s]) || s;
}

function fmt(s, a, b) {
	var out = tr(s);
	if (a !== undefined) out = out.replace('%s', a);
	if (b !== undefined) out = out.replace('%s', b);
	return out;
}

// ---------------------------------------------------------------------------
// ubus
// ---------------------------------------------------------------------------
var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});

var callInitList = rpc.declare({
	object: 'luci',
	method: 'getInitList',
	params: [ 'name' ],
	expect: { '': {} }
});

// 各版本 luci.getInitList 返回的字段是 {index, enabled}(21.02)或
// {index, stop, enabled}(23.05+)——从来没有 running。用它判断运行态会恒为
// false,两个服务永远显示"已停止"。运行状态改问 procd 自己的 service list
// (21.02+ 均可用),enabled(自启)仍然来自 getInitList。
var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function isRunning(serviceListResult, name) {
	var svc = serviceListResult && serviceListResult[name];
	var instances = svc && svc.instances;
	if (!instances) return false;
	for (var key in instances) {
		if (Object.prototype.hasOwnProperty.call(instances, key) &&
		    instances[key] && instances[key].running === true) {
			return true;
		}
	}
	return false;
}

function serviceState(name) {
	return Promise.all([ callInitList(name), callServiceList(name) ]).then(function (res) {
		var initEntry = res[0][name] || {};
		return { enabled: initEntry.enabled === true, running: isRunning(res[1], name) };
	}).catch(function () {
		return { enabled: false, running: false };
	});
}

// 按顺序执行一串 init 动作,全部成功才提示成功。内核的「停止」需要 stop + disable
// 两步(见下方 render() 里 sing-box 内核卡片的说明),所以这里接受数组而不是单个动作。
function act(name, actions) {
	var list = (typeof actions === 'string') ? [ actions ] : actions;
	var chain = Promise.resolve();

	list.forEach(function (action) {
		chain = chain.then(function () {
			return callInitAction(name, action).then(function (ok) {
				if (!ok) {
					throw new Error(tr('init action failed') + ' (' + action + ')');
				}
			});
		});
	});

	return chain.then(function () {
		ui.addNotification(null, E('p', fmt('Action sent: %s %s', name, list.join(' + '))), 'info');
		window.setTimeout(function () { location.reload(); }, 1200);
	}).catch(function (err) {
		ui.addNotification(null, E('p', fmt('Action failed: %s', err.message || err)), 'error');
	});
}

// ---------------------------------------------------------------------------
// 版本
// ---------------------------------------------------------------------------
var META_PATH = '/opt/open-box/meta.json';
var REPO = 'liandu2024/Open-Box';

function readInstalledVersion() {
	return fs.read(META_PATH).then(function (txt) {
		var meta = JSON.parse(txt);
		return meta && meta.version ? String(meta.version) : null;
	}).catch(function () {
		return null;
	});
}

// sing-box 内核的版本号是随 Open-Box 发行版本一起钦定、写死进 meta.json 的构建期
// 常量(见 scripts/build-release.sh 的 SINGBOX_VERSION),不是探测运行中的二进制
// 现查出来的——这里只是读出这个钦定值展示给用户。之所以不提供独立于 Open-Box 发行
// 版本的内核升级入口:发布时生成的 sing-box 配置是照着这个确切版本量身写的,而
// sing-box 的配置 schema 在小版本之间会变(例如 1.11 → 1.12 整个重写了 DNS 段)。
// 独立升级内核会打破"配置版本"与"内核版本"的对应关系,新内核可能直接拒绝启动
// 旧配置。所以内核版本随 Open-Box 整个发行版本一起走:要升级内核,走 Open-Box
// 面板区块的"立即更新"(见 render() 里 sing-box 内核卡片的说明文字)。
function readInstalledSingboxVersion() {
	return fs.read(META_PATH).then(function (txt) {
		var meta = JSON.parse(txt);
		return meta && meta.singboxVersion ? String(meta.singboxVersion) : null;
	}).catch(function () {
		return null;
	});
}

// 语义化比较:返回 1 表示 a 比 b 新,-1 表示旧,0 表示相同。
function cmpVersion(a, b) {
	var pa = String(a).replace(/^v/i, '').split(/[.\-+]/);
	var pb = String(b).replace(/^v/i, '').split(/[.\-+]/);
	for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
		var na = parseInt(pa[i], 10), nb = parseInt(pb[i], 10);
		if (isNaN(na)) na = -1;
		if (isNaN(nb)) nb = -1;
		if (na > nb) return 1;
		if (na < nb) return -1;
	}
	return 0;
}

// 检查在浏览器里发起(而不是路由器),这样即便路由器本身还没配好代理也能查。
// 网络受限时优雅失败,不影响页面其它功能。
function checkLatest() {
	return fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
		headers: { 'Accept': 'application/vnd.github+json' }
	}).then(function (r) {
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	}).then(function (j) {
		if (!j || !j.tag_name) throw new Error('no tag');
		return String(j.tag_name);
	});
}

var UNINSTALL_PATH = '/opt/open-box/uninstall.sh';

// 卸载走本地脚本(随发布包铺下来的那份),不依赖外网——这个页面存在的意义就是
// 面板/网络出问题时还能操作。fs.exec 需要 ACL 里对该路径的 exec 授权。
function runUninstall(purge) {
	var args = purge ? [ '--purge' ] : [];
	return fs.exec(UNINSTALL_PATH, args).then(function (res) {
		if (!res || res.code !== 0) {
			var detail = (res && (res.stderr || res.stdout)) || ('exit ' + (res ? res.code : '?'));
			throw new Error(String(detail).split('\n').slice(-3).join(' ').trim() || 'failed');
		}
		return res;
	});
}

// ---------------------------------------------------------------------------
// 一键更新
//
// rpcd 的 fs.exec 同步等待且有超时,升级却要下载约 80MB,同步调用必然中途
// 超时,所以这里总是带 --detach 调用:update.sh 自己 fork 到后台立即返回,
// 真正的下载/替换在后台独立进程里进行,页面转而轮询 meta.json 的版本号,
// 以及 update.sh 写的日志(用于展示进度/失败详情)。
//
// 根因(已在真机上确认,不再是猜测):即便 --detach 分支本身几乎瞬间返回,
// LuCI 这一侧发起 fs.exec 用的是一次有超时的 XHR——在这台硬件上,这次 XHR
// 会先于 rpcd 真正把响应送回来到达自己的超时,于是 fs.exec 的 promise 以
// "XHR request timed out" reject,即使 --detach 派发和后台 worker 完全正常。
// 旧版把"弹窗该显示什么"、"何时开始轮询状态文件"、"卡死/读不到的兜底计时"
// 统统挂在这个 promise 的 .then()/.catch() 上,于是这次 XHR 超时被直接当成
// "更新失败"报给用户,而真实情况是 /tmp/openbox-update.status 一路推进到
// stage=done——升级本身完全成功,只是弹窗的结论来源问题问错了对象。
//
// 修复不是去调大超时,而是换掉"谁说了算":状态文件才是事实来源。update.sh
// 的 --detach 分支在真正 fork 子进程之前,就已经同步把 stage=starting 写进
// 状态文件(见该脚本 --detach 小节的注释)——这次写入不依赖 fs.exec 的 XHR
// 是否顺利收到响应。所以下面 startUpdate() 里,状态文件轮询(applyStatus/
// progressTimer)与版本号轮询(pollForUpdateCompletion())在调用 runUpdate()
// 的同时就独立起跑,不再等待、也不再依赖这个 promise 结算;runUpdate() 的
// resolve/reject 结果降级为"仅供参考"——只有在 reject 发生、且状态文件完全
// 没有显示出这次更新真的跑起来过的任何证据时(文件不存在,或停在这次调用
// 之前就有的旧 stage 没有任何变化),才把这次 exec 错误当成失败结论的来源;
// 只要状态文件显示出进展或已完成,这个 exec 错误就被当噪音丢弃,交给已经在
// 独立运行的两路轮询给出真正的结论(见 startUpdate() 里 updateObserved 的
// 说明)。
// ---------------------------------------------------------------------------
var UPDATE_PATH = '/opt/open-box/update.sh';
var UPDATE_LOG_PATH = '/tmp/openbox-update.log';
var UPDATE_POLL_INTERVAL_MS = 4000;
var UPDATE_POLL_TIMEOUT_MS = 480000; // 8 分钟:78MB 下载 + 解包 + 换文件的宽松上限

// update.sh 的 --detach 分支在真正 fork 子进程之前,就同步把 stage=starting 写进
// 状态文件(见该脚本 --detach 小节的注释,以及上面关于 fs.exec XHR 超时根因的
// 说明)。如果子进程随后因为任何原因没有真正跑起来或者刚起来就死掉(fork 失败、
// rpcd 提前收走了进程组、脚本路径/权限出了问题……),状态文件会永远停在
// starting——只靠上面 8 分钟的总超时,技术上"最终会结束",但用户会盯着一句
// "正在准备…"干等 8 分钟,期间没有任何信息。这里单独给"starting 阶段本身"设一个
// 短得多的兜底超时:轮询到状态文件确实读到了、但 stage 仍是 starting(或空)累计
// 超过这个时长,就不再当成正常进度,转而直接展示一个"启动失败/无响应"的明确结论
// (见 startUpdate() 里 handleStartingStuck() 的说明)。stage 一旦推进到 starting
// 之外的任何阶段(包括 failed/cancelled 这些终态——它们有自己明确的结论,不需要
// 这个兜底),这个计时器就会被重置——正常路径(几秒内就该进入 probing/downloading)
// 不受任何影响。既然状态轮询现在与 fs.exec 完全独立起跑,这个兜底本身就已经能
// 独立兜住"exec 迟迟没有回音"的情形,不再需要一个单独盯着 exec 本身的看门狗
// (旧版曾经加过一个,现已随这次改动一起移除——它的职责被这里和下面
// handleStatusUnreadable() 完全覆盖,继续保留反而会出现三路兜底互相抢结论)。
//
// 这个阈值同时也被复用为另一路独立计时的判定线:状态文件本身读取失败(不是
// "读到了但 stage 还没推进",而是 fs.read 直接被拒绝/出错,典型情况见
// readUpdateStatus() 顶部关于 LuCI 会话级 ACL 的说明)累计超过这个时长,走的是
// handleStatusUnreadable() 那条完全不同的提示,不会被这里的"启动失败"结论
// 冒名——两路计时各自独立、只是共用同一个"多久算异常"的时长判断,见 startUpdate()
// 里 progressTimer 回调对 res.ok 的分支处理。
var STARTING_STUCK_TIMEOUT_MS = 20000; // 20 秒

// update.sh 每秒左右重写一次的进度/取消状态文件,纯 key=value 文本(不是
// JSON——两边都是这么约定的,见 scripts/update.sh 里 write_status() 的注释)。
// 路径与该脚本里 STATUS_PATH 的默认值(TMPDIR 未设置时)保持一致,和
// UPDATE_LOG_PATH 同理硬编码 /tmp——rpcd 环境下 TMPDIR 通常不会被设置。
// 用比"决定成功/失败"的 UPDATE_POLL_INTERVAL_MS 更短的间隔单独轮询它,只用来
// 驱动进度条/取消按钮这些次要 UI,不参与"更新到底成功没有"的判定——那个判定
// 仍然是版本号 + 日志正则那一套(见 pollForUpdateCompletion()),按需求原样保留。
var UPDATE_STATUS_PATH = '/tmp/openbox-update.status';
var UPDATE_STATUS_POLL_INTERVAL_MS = 1000;

// 与 scripts/update.sh 里"可安全取消的阶段"完全对应(见该脚本 check_cancel_
// _and_abort() 调用点的分布)——committing 及之后不再出现在这张表里,取消按钮
// 据此隐藏。
var CANCELLABLE_STAGES = {
	starting: true,
	probing: true,
	downloading: true,
	verifying: true,
	extracting: true
};

// 解析 update.sh 写的 key=value 状态文件:每行"键=剩余全部内容",不按 = 再切
// (message 字段本身不会包含 = ,但即使包含,取"第一个 = 之后的全部"也不会错)。
// bytes/total 只有整数才采信,格式不对就当缺失,交给调用方退化处理,不强行拼出
// 一个可能算错的百分比。
function parseUpdateStatus(txt) {
	var out = { pid: '', stage: '', bytes: null, total: null, message: '' };
	String(txt || '').split('\n').forEach(function (line) {
		var i = line.indexOf('=');
		if (i === -1) return;
		var k = line.slice(0, i), v = line.slice(i + 1);
		if (k === 'pid') out.pid = v;
		else if (k === 'stage') out.stage = v;
		else if (k === 'bytes') out.bytes = /^[0-9]+$/.test(v) ? parseInt(v, 10) : null;
		else if (k === 'total') out.total = /^[0-9]+$/.test(v) ? parseInt(v, 10) : null;
		else if (k === 'message') out.message = v;
	});
	return out;
}

// 读取失败(rpcd ACL 拒绝、文件暂不存在等)与"读到了但内容为空/还没写出有效
// stage"是两种含义完全不同的情况,不能再像旧版 .catch(() => null) 那样把两者
// 压成同一个 null——真实故障案例证明了这一点:LuCI 的会话在登录时就把该会话
// 能读写哪些 ubus/文件对象一次性算好并缓存下来,之后新增的 ACL 授权不会让已经
// 登录的旧会话跟着变宽(哪怕重启 rpcd 也不会,重启只影响此后新建立的会话)。
// /tmp/openbox-update.status 的读权限是后来才加进 ACL 的,一个跨越了这次权限
// 变更的旧会话读它会一直被拒绝,而读 meta.json(更早就在 ACL 里)照样成功——
// 界面上会出现"版本读得到、状态读不到"这种局部失灵,旧版把这种"读不到"和
// "文件确实还没写出内容"混成同一个 null,调用方没法区分,只能眼睁睁看着进度
// 卡在初始文案。返回值统一三态:{ ok:true, status } 读到了(status.stage 可能
// 是空字符串,代表"读到了但还没来得及写出有效阶段");{ ok:false, error } 读取
// 本身失败,error 原样带出,供调用方在需要时展示细节或据此单独计时(参见
// startUpdate() 里 handleStatusUnreadable() 的用法,与 handleStartingStuck()
// 是两条不冒充彼此结论的独立路径)。
function readUpdateStatus() {
	return fs.read(UPDATE_STATUS_PATH).then(function (txt) {
		return { ok: true, status: parseUpdateStatus(txt), error: null };
	}).catch(function (err) {
		return { ok: false, status: null, error: err };
	});
}

// 阶段 → 展示用的动词短语,不带任何动态数值(百分比/字节数另由 progressDetail()
// 拼在旁边,避免这里的翻译串里塞 3 个 %s——fmt() 只支持替换 2 个)。
function stageText(status) {
	switch (status && status.stage) {
		case 'starting': return tr('Preparing...');
		case 'probing': return tr('Probing channels...');
		case 'downloading': return tr('Downloading...');
		case 'verifying': return tr('Verifying checksum...');
		case 'extracting': return tr('Extracting...');
		case 'committing': return tr('Replacing program files (cannot cancel)...');
		case 'cancelled': return tr('Update cancelled.');
		case 'failed': return tr('Update failed.');
		case 'done': return tr('Finishing...');
		default: return tr('Starting update...');
	}
}

// downloading 阶段拼出 "12.3 / 78.1 MB (16%)" 这样的详情行;total 未知(HEAD
// 探测不到 Content-Length)时退化成只显示已下载的字节数,不编造百分比——与
// update.sh 那边"拿不到 total 就传空字符串"的约定对应。failed/cancelled 阶段
// 复述 update.sh 写的 message(它本来就是中文,不查 i18n 表——这和日志尾巴、
// die() 输出一律直接展示中文是同一个既有约定)。
function progressDetail(status) {
	if (!status) return '';
	if (status.stage === 'downloading' && status.bytes != null) {
		var mb = (status.bytes / (1024 * 1024)).toFixed(1);
		if (status.total != null && status.total > 0) {
			var totalMb = (status.total / (1024 * 1024)).toFixed(1);
			var pct = Math.min(100, Math.floor(status.bytes / status.total * 100));
			return mb + ' / ' + totalMb + ' MB (' + pct + '%)';
		}
		return mb + ' MB';
	}
	if ((status.stage === 'failed' || status.stage === 'cancelled') && status.message) {
		return status.message;
	}
	return '';
}

// 判断"当前轮询到的状态是否应该被当成 starting 阶段卡死"的纯函数,不依赖任何
// DOM/LuCI 全局(不摸 ui/fs/window),方便脱离页面渲染单独做单元验证——这台开发机
// 上没有真正的 LuCI 运行环境,页面本身无法渲染,这类纯函数是能被独立验证的最小
// 单元(见本次改动的验收要求)。status 为 null(状态文件还没读到)、或者读到了但
// 缺 stage 字段、或者 stage 就是 'starting',这三种情况一视同仁,都算"还没真正
// 起步",按同一套累计时长计数;调用方(startUpdate() 里的 progressTimer 回调)
// 负责维护 elapsedMs——每次轮询到仍处于上述三种情况就加一个轮询间隔,一旦推进到
// 其它任何阶段(哪怕是 failed/cancelled 这些终态,它们有自己明确的结论)就归零。
// 这里只管"给定当前 status 与累计时长,是否已经越过阈值"这一个判断,不产生任何
// 副作用,也不读写调用方的计时状态——保持纯函数,才能不需要真的跑一遍 20 秒
// 就在单元测试里直接喂 elapsedMs 验证边界。
function isUpdateStartStuck(status, elapsedMs) {
	var stillStarting = !status || !status.stage || status.stage === 'starting';
	return stillStarting && elapsedMs >= STARTING_STUCK_TIMEOUT_MS;
}

// 取消一次正在运行的更新:调用 update.sh --cancel(协作式,不发任何信号——见该
// 脚本对应小节的说明),解析 stdout 第一个词得到三种结局之一。exec 本身失败
// (脚本不存在、ACL 拒绝等)走 reject,和 runUpdate()/probeChannel() 同样的
// 错误处理方式(截取 stderr/stdout 最后几行拼进 Error)。
function requestCancel() {
	return fs.exec(UPDATE_PATH, [ '--cancel' ]).then(function (res) {
		if (!res || res.code !== 0) {
			var detail = (res && (res.stderr || res.stdout)) || ('exit ' + (res ? res.code : '?'));
			throw new Error(String(detail).split('\n').slice(-3).join(' ').trim() || 'failed');
		}
		var line = String(res.stdout || '').split('\n')[0];
		return line.replace(/^\s+|\s+$/g, '');
	});
}

// channel 是用户在"版本"卡片的渠道下拉框里选中的值:'direct' 强制直连 GitHub;
// 其它值是一个镜像前缀(渠道选择器固定的三个内置镜像之一,见下方 CHANNELS,与
// scripts/update.sh 的 BUILTIN_MIRRORS 保持一致),原样透传给 update.sh 的
// --mirror <前缀>——用户已经在下拉框里显式选了具体渠道(通常还刚探测过连通性),
// 不需要再让 update.sh 自己去挑一个。--detach 之外再带上路线参数透传给 update.sh。
function runUpdate(channel) {
	var args = [ '--detach' ];
	if (channel === 'direct') {
		args.push('--direct');
	} else {
		args.push('--mirror', channel);
	}
	return fs.exec(UPDATE_PATH, args).then(function (res) {
		if (!res || res.code !== 0) {
			var detail = (res && (res.stderr || res.stdout)) || ('exit ' + (res ? res.code : '?'));
			throw new Error(String(detail).split('\n').slice(-3).join(' ').trim() || 'failed');
		}
		return res;
	});
}

// 同 readUpdateStatus():区分"读取失败"与"读到了",理由同上。始终附带 text
// 字段(失败时为空字符串),方便大多数只关心"能展示什么"的调用方直接取用,
// 不必先判断 ok 再决定怎么退化——和旧版把两者都压成一个空字符串相比,唯一的
// 差别只是把 error 也带出来给需要区分的调用方(目前只有极少数调用点关心)。
function readUpdateLogTail() {
	return fs.read(UPDATE_LOG_PATH).then(function (txt) {
		return { ok: true, text: String(txt || '').split('\n').slice(-12).join('\n').replace(/^\s+|\s+$/g, ''), error: null };
	}).catch(function (err) {
		return { ok: false, text: '', error: err };
	});
}

// ---------------------------------------------------------------------------
// 渠道探测
//
// 探测必须在路由器上做,不能在浏览器里做:浏览器这一端的网络状况和路由器的完全
// 是两回事——真正要下载 76MB 安装包的是路由器,浏览器这边"通"不代表路由器那边也
// "通"。而且浏览器直接 fetch 一个 gh-proxy 类地址会被 CORS 挡下:这类镜像站不会
// 给 LuCI 页面的源开跨域头。所以探测走 fs.exec 调 update.sh 的 --probe <渠道>,
// 复用它内部同一份"抓 .sha256 并校验内容格式"的判定逻辑(64 位十六进制哈希 + 匹配
// 的资产名),而不是自己另写一套只看 HTTP 状态码的检测——那样会把"200 但是个
// HTML 错误页"的假死镜像误判为可用,见 scripts/update.sh 里 probe_mirror_prefix()
// 的注释。
//
// 一次只探测一个渠道:rpcd 的 fs.exec 本身有超时,4 个渠道放进一次 exec 里一起测
// 有拖到超时的风险。所以"一键检测"改在页面这一层循环 4 个渠道、依次各发起一次
// exec,每测完一个就更新那一行的状态(见 render() 里的 probeOneChannel())——这样
// "一键检测"按钮和每个渠道行自己的「检测」按钮天然共用同一条代码路径,不用分别
// 写两套逻辑。
//
// update.sh 的 --probe 无论探测成功还是失败都固定以 exit 0 退出,靠 stdout 第一个
// 词(ok / fail)区分,这里照着解析;exec 本身失败(脚本不存在、ACL 拒绝等)才走
// catch,同样折算成"不可用",不单独区分给用户看。
function probeChannel(value) {
	return fs.exec(UPDATE_PATH, [ '--probe', value ]).then(function (res) {
		var line = String((res && res.stdout) || '').split('\n')[0] || '';
		var sp = line.indexOf(' ');
		var kind = sp === -1 ? line : line.slice(0, sp);
		var rest = sp === -1 ? '' : line.slice(sp + 1).replace(/^\s+/, '');
		if (kind === 'ok') {
			var ms = parseInt(rest, 10);
			return { ok: true, ms: isNaN(ms) ? null : ms };
		}
		return { ok: false, reason: rest || kind || 'failed' };
	}).catch(function (err) {
		return { ok: false, reason: String(err && err.message || err) };
	});
}

// 轮询直到成功、确认无需升级、脚本报错,或者超时——四种结局都通过 resolve 的
// result 对象表达(不用 reject),调用方只需要看 result.ok / result.noop /
// result.timeout,不必分别处理 resolve 和 reject 两条路径。
function pollForUpdateCompletion(oldVersion, onTick) {
	return new Promise(function (resolve) {
		var elapsed = 0;

		function scheduleNext(logTail) {
			elapsed += UPDATE_POLL_INTERVAL_MS;
			if (elapsed >= UPDATE_POLL_TIMEOUT_MS) {
				resolve({ ok: false, timeout: true, logTail: logTail || '' });
				return;
			}
			window.setTimeout(tick, UPDATE_POLL_INTERVAL_MS);
		}

		function tick() {
			Promise.all([ readInstalledVersion(), readUpdateLogTail(), readUpdateStatus() ]).then(function (res) {
				// 版本号判定(下面这个 if)排在最前面、且完全不看 statusRes——这就是
				// "更新到底成功没有"这个结论对状态文件的读取失败免疫的落地点:哪怕
				// readUpdateStatus() 这次(乃至这次更新期间自始至终)都是 ok:false,
				// 版本号一旦真的变了,这里照样能 resolve 出成功,不依赖状态文件半点
				// 信息。状态文件只在下面 statusRes.ok 为真时,负责一件事:提前给出
				// "已取消"这个终态,免得白等到超时——不参与成功/失败本身的判定。
				var version = res[0], logTail = res[1].text, statusRes = res[2];
				if (onTick) onTick(logTail);
				if (version && version !== oldVersion) {
					resolve({ ok: true, noop: false, version: version, logTail: logTail });
					return;
				}
				// update.sh 在"下载完才发现版本号和当前一致"时会打印这句并正常退出
				// (见脚本里的判断),此时版本号不会变,不能当成超时/失败处理。
				if (/无需升级/.test(logTail)) {
					resolve({ ok: true, noop: true, version: oldVersion, logTail: logTail });
					return;
				}
				// update.sh 的 die() 统一用这个前缀,匹配到就说明脚本已经退出且失败了,
				// 不必再等到超时才告诉用户。
				if (/\[open-box\] 错误:/.test(logTail)) {
					resolve({ ok: false, timeout: false, logTail: logTail });
					return;
				}
				// 状态文件先于日志正则给出"已取消"这个明确结论——用户点了取消按钮,
				// 不该被当成超时或失败处理,单独给一个结局分支。statusRes.ok 为假(这次
				// 读取失败)时天然跳过这个分支、落到下面的 scheduleNext 继续轮询,不会
				// 被误判成"没有取消"——读取失败不代表任何结论,只是这次没读到。
				if (statusRes.ok && statusRes.status && statusRes.status.stage === 'cancelled') {
					resolve({ ok: false, cancelled: true, logTail: logTail });
					return;
				}
				scheduleNext(logTail);
			}).catch(function () {
				scheduleNext('');
			});
		}

		tick();
	});
}

// ---------------------------------------------------------------------------
// 布局
//
// 不用 cbi-page-actions:那是「页面底部」的操作栏(右对齐 + 特定外边距),
// 一页只该出现一次。放进每张卡片会让按钮脱离卡片右飘、压到下一张卡片上。
//
// 四张功能块本该是固定 2×2 网格,但内联样式表达不了媒体查询——早先只能用
// `grid-template-columns: repeat(auto-fit, minmax(340px,1fr))` 打补丁,后果是
// 宽屏上一行能塞下 3 个甚至更多 340px 格子,渲染成 3 列 + 一个孤立的第 4 块,
// 完全不是设计要的 2×2。解法是不再用内联样式硬顶,把一份用 `ob-` 命名空间前缀
// 的 <style> 元素注入渲染树最前面(见 STYLE_CSS,以及 render() 里把它作为
// 返回的 div 的第一个子节点),靠真正的 CSS 类 + 媒体查询把网格锁定成两列,
// 窄屏(<900px,含手机上的 LuCI)collapse 成一列。前缀 `ob-` 是为了在任意 LuCI
// 主题(该页面会在各种主题、包括用户自定义的主题下被访问)里都不会跟主题自带的
// CSS 类同名撞车。颜色同样不写死明暗主题:一律用灰色透明度叠加或 currentColor,
// 只有状态色(在/离线、渠道可用/不可用)用足够高对比度、明暗主题下都能看清的
// 固定色值。
//
// 弹窗(卸载确认、更新失败详情、更新进度)不在这次改版范围内,继续用下面这两个
// 通用内联样式行:它们只是简单的 flex 行,没有网格、不需要媒体查询,原有写法
// 没有问题。
// ---------------------------------------------------------------------------
var ROW = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5em;margin:.4em 0';
var BTNROW = 'display:flex;flex-wrap:wrap;gap:.5em;margin:.8em 0 .2em 0';

// 注入到渲染树最前面的命名空间样式表:所有类名都以 `ob-` 开头,避免和 LuCI
// 主题的 CSS 撞车。2×2 网格 + 900px 断点收缩成单列是这里唯一的媒体查询,
// align-items:start 让矮的卡片保持自身高度、不被网格拉伸成一格空盒子。
var STYLE_CSS =
	// 页面标题行:标题在左、卸载按钮在最右。卸载原本是网格里的第四张卡片,但
	// 那让一个纯破坏性动作占据了和三个日常功能同等的版面权重;现在它退到页面
	// 标题右侧,和 LuCI 各页面把全局动作放标题行的习惯一致。注意这个类是加在
	// <h2> 自己身上、而不是外面再套一层 <div>:主题对页面标题的样式常写成
	// `#maincontent > .container > h2` 这类直接子元素选择器,包一层会让标题
	// 在部分主题下丢掉样式。按钮显式给字号,否则它会继承 h2 的大字号。
	'h2.ob-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75em}' +
	'h2.ob-head .cbi-button{margin-left:auto;font-size:.875rem;font-weight:600;line-height:1.4}' +
	// 标题条和下面的网格共用同一个宽度上限,右边缘才会对齐。主题把 <h2> 画成一条
	// 通栏白条,不限宽的话它会一直顶到窗口右侧,而内容网格停在 1400px,宽屏上右边
	// 缘差出一大截。box-sizing 显式写成 border-box:主题给 h2 加了左右内边距,若
	// 继承到 content-box,这条白条会比网格宽出内边距那么多,仍然对不齐。
	'h2.ob-head,.ob-wrap{max-width:1400px;box-sizing:border-box}' +
	// 标题行里"贴着标题走"的那一组(h2 是说明文字,h3 是状态徽标)。必须自成一个
	// flex 容器:h2/h3 本身是 justify-content:space-between,平铺进去的话中间那项
	// 会被摊到行正中,而不是紧跟标题。
	'.ob-h2-left,.ob-h3-left{display:flex;flex-wrap:wrap;align-items:center;gap:.75em;min-width:0}' +
	// 标题行右端那一组按钮(升级卡片的「一键检测可用升级渠道」+「检查更新」)。
	// 同样得自成一个 flex 容器,否则 space-between 会把它们摊开成"标题…按钮…按钮"。
	'.ob-h3-right{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
	// 置灰不可点的兜底:Argon 自带 .cbi-button:disabled(opacity .5 + not-allowed),
	// 但「没有更新时按钮必须是灰的、点不动」是这里的功能要求,不能指望每个主题都
	// 替我们实现。pointer-events:none 连 hover 态一起掐掉,避免灰着却还有悬停高亮。
	'.ob-card h3 .cbi-button:disabled{opacity:.5;cursor:not-allowed;pointer-events:none;box-shadow:none}' +
	// 说明文字显式给字号与字重:它现在长在 <h2> 里,不这么写就会被标题的大号粗体
	// 同化,读起来像第二个标题而不是一句注解。
	'.ob-descr{font-size:.875rem;font-weight:400;opacity:.7;line-height:1.4}' +
	// 副标题末尾那条面板地址:靠 margin-left 和前面的文案分开,而不是在 i18n 词条
	// 里塞一个尾随空格(不可见、编辑时极易丢),中英文冒号后的松紧也能各自合适。
	'.ob-descr a{margin-left:.4em}' +
	'.ob-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;margin-top:12px}' +
	// 卸载卡片撤走后网格只剩三张:两列排布会在右下角留一个空格子。让内容最多的
	// 「Open-Box 升级」横跨两列把这个洞填掉(渠道列表另有 max-width 兜着,不会
	// 被拉成横贯全屏的稀疏长条)。
	'.ob-card-wide{grid-column:1/-1}' +
	'@media (max-width:900px){.ob-grid{grid-template-columns:1fr}}' +
	'.ob-card{border:1px solid rgba(127,127,127,.22);border-radius:10px;padding:16px 18px;background:rgba(127,127,127,.04)}' +
	// 卡片标题行:标题在左、版本在右,底下一条横线收口。
	//
	// background/padding/border-radius/box-shadow 这四个是**复位**,不是装饰:
	// 主题会把裸 <h3> 当成"卡片头"来画。Argon 的 cascade.css 里就是
	//   h3{padding:.8755rem 1.25rem;border-radius:.25rem;background:var(--white);
	//      display:block;width:100%}
	// 于是我们卡片里的标题被套上一层白色圆角块,看起来像卡片里又嵌了张卡片。
	// 这些是裸元素选择器(0-0-1),`.ob-card h3` 是 0-1-1、且注入的 <style> 在
	// <body> 里排在主题 <link> 之后,足以压过去,不需要 !important。其它主题若
	// 也按这个套路给标题上底色,同样会被这几条复位掉。
	//
	// 横线用 h3 自己的 border-bottom,而不是再插一个元素:它天然只有 h3 那么宽
	// (卡片内容宽度,不含卡片左右 18px 内边距),不会通栏顶到卡片边缘。
	'.ob-card h3{margin:0 0 12px;padding:0 0 10px;background:none;border:0;border-bottom:1px solid rgba(127,127,127,.22);border-radius:0;box-shadow:none;font-size:1.05em;font-weight:600;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75em}' +
	// 标题行右侧放按钮时(升级卡片的「一键检测可用升级渠道」)必须显式给字号,
	// 否则它会继承 h3 的 1.05em 变成一颗大按钮,把标题行撑歪。
	'.ob-card h3 .cbi-button{font-size:.875rem;font-weight:600;line-height:1.4}' +
	// margin-left:auto 不是为了单行时靠右(space-between 已经做到了),而是为了
	// **换行之后**仍然靠右:卡片一窄,标题 + 状态徽标就占满第一行,版本号被挤到
	// 第二行——那一行只有它一个,没有 auto 就会贴着左边缘,看着像另起了一段。
	'.ob-ver{margin-left:auto;font-size:.85em;font-weight:600;opacity:.75;white-space:nowrap}' +
	// font-weight/font-size 写死:徽标现在长在 <h3> 里,不写就会继承标题的粗体、
	// 字号也跟着 h3 放大,一行里两种粗体读起来分不出主次。
	'.ob-pill{display:inline-flex;align-items:center;gap:.35em;padding:.15em .65em;border-radius:999px;font-size:.8rem;font-weight:400;border:1px solid currentColor;white-space:nowrap}' +
	'.ob-pill-on{color:#2e9e4f}' +
	'.ob-pill-off{color:#d04a4a}' +
	'.ob-pill-muted{opacity:.7;border-color:rgba(127,127,127,.4)}' +
	'.ob-btns{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}' +
	'.ob-meta{display:flex;flex-wrap:wrap;gap:.5em;align-items:baseline;margin:.4em 0;font-size:.95em}' +
	// 升级卡片中段那条分隔线跟着标题线一起收进内容宽度:原来用负 margin 通栏
	// (margin:14px -18px)顶到卡片边缘,现在同一张卡片里若一条线通栏、一条线
	// 不通栏,会显得是没对齐的 bug。
	// max-width:升级卡片横跨两列后,渠道行若跟着撑满整屏,行首的名字和行尾的
	// 状态/按钮之间会拉开一大片空白,读起来要来回扫视。
	// 4 个渠道各自成块、并排一行(升级卡片横跨整行,宽度够)。窄屏依次收成
	// 两列、一列。旧版是一个带边框的竖直列表(.ob-chan 画框、行与行之间用
	// border-top 分隔),4 行叠下来把卡片拉得很高,右边一大片空白却闲着。
	'.ob-chan{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0 0}' +
	'@media (max-width:1150px){.ob-chan{grid-template-columns:repeat(2,1fr)}}' +
	'@media (max-width:640px){.ob-chan{grid-template-columns:1fr}}' +
	'.ob-chan-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border:1px solid rgba(127,127,127,.2);border-radius:8px}' +
	'.ob-chan-row:hover{background:rgba(127,127,127,.06)}' +
	'.ob-chan-radio{display:flex;align-items:center;gap:.5em;min-width:0;cursor:pointer}' +
	'.ob-chan-radio input{flex:none;margin:0;cursor:pointer}' +
	'.ob-chan-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
	'.ob-chan-stat{margin-left:auto;font-size:.85em;opacity:.85;white-space:nowrap}' +
	'.ob-chan-ok{color:#2e9e4f}' +
	'.ob-chan-bad{color:#d04a4a}';

return view.extend({
	load: function () {
		return Promise.all([
			serviceState('openbox'),
			serviceState('openbox-panel'),
			readInstalledVersion(),
			readInstalledSingboxVersion()
		]);
	},

	render: function (data) {
		var core = data[0], panel = data[1], installed = data[2], singboxVersion = data[3];
		var panelUrl = 'http://' + window.location.hostname + ':2026';
		var self = this;

		// -------------------------------------------------------------------
		// 渠道选择器
		//
		// 4 个渠道:GitHub 直连 + 3 个内置镜像,与 scripts/update.sh 的
		// BUILTIN_MIRRORS 保持一致——两边都是各自独立铺开的文件(一个 curl|sh
		// 单文件脚本,一个 LuCI 视图),没有可共享的公共库,只能分别维护同一份
		// 内容。"立即更新"用的就是这里选中的渠道(见 showUpdateDialog()),不再
		// 像旧版那样让 update.sh 自己从内置列表里自动挑一个。
		// -------------------------------------------------------------------
		var CHANNELS = [
			{ value: 'direct', label: tr('GitHub direct') },
			{ value: 'https://ghfast.top', label: 'ghfast.top' },
			{ value: 'https://gh-proxy.com', label: 'gh-proxy.com' },
			{ value: 'https://gh.llkk.cc', label: 'gh.llkk.cc' }
		];

		function channelLabel(value) {
			for (var i = 0; i < CHANNELS.length; i++) {
				if (CHANNELS[i].value === value) return CHANNELS[i].label;
			}
			return value;
		}

		// value -> null(未测试过)| 'pending'(正在测)| { ok: true, ms } | { ok: false, reason }
		var channelResults = {};
		CHANNELS.forEach(function (c) { channelResults[c.value] = null; });

		function channelStatusSuffix(value) {
			var r = channelResults[value];
			if (r === 'pending') return tr('Testing...');
			if (r == null) return tr('Not tested yet');
			if (r.ok) return fmt('Available %sms', (r.ms != null ? r.ms : '?'));
			return tr('Unavailable');
		}

		// 组合出类似 "GitHub 直连: 可用 320ms" / "ghfast.top: 不可用" 这样单行的
		// 渠道状态,一键检测/单渠道检测的结果、以及"立即更新"按钮旁的选中渠道摘要
		// 共用同一个格式,读起来始终一致。
		function channelStatusText(value) {
			return channelLabel(value) + ': ' + channelStatusSuffix(value);
		}

		// 每张卡片是一个自成一体的功能块:状态/控制在上,该组件自己的版本信息(如有)
		// 在下,都装进同一个 .ob-card 容器里——而不是像旧版那样把「版本」拆成页面
		// 末尾单独一张卡片,那样读者要在两张卡片之间来回对应"这个版本号说的是哪个
		// 组件"。渠道选择/探测/升级操作篇幅较大、也不是"某个组件自己的版本信息",
		// 所以单独成一张「Open-Box 升级」卡片,不塞进这里。
		//
		// 内核卡片、面板卡片结构上只有两处不同(面板卡片的状态行多一个跳转链接、
		// 内核卡片的按钮行下面多一句「停止」的说明文字),其余(状态/自启徽标、
		// 启停控制四个按钮)完全一致,所以拆成 statusPills()/serviceButtons() 两个
		// 小工具,分别在下面 render() 返回值里拼装两张卡片,而不是像旧版 serviceCard()
		// 那样塞一堆可选参数把两种结构揉进一个函数。
		function statusPills(st) {
			return [
				E('span', { 'class': 'ob-pill ' + (st.running ? 'ob-pill-on' : 'ob-pill-off') },
					'● ' + (st.running ? tr('running') : tr('stopped'))),
				E('span', { 'class': 'ob-pill ob-pill-muted' },
					tr('Autostart') + ' ' + (st.enabled ? tr('on') : tr('off')))
			];
		}

		// 卡片标题行:标题 + 紧跟其后的状态徽标在左,版本号在右。
		// 徽标必须和标题一起裹进 .ob-h3-left:h3 是 justify-content:space-between,
		// 直接把三者平铺进去的话,徽标会被摊到行正中间,而不是"贴着标题"。
		function cardTitle(title, st, version) {
			return E('h3', {}, [
				E('div', { 'class': 'ob-h3-left' }, [ E('span', {}, title) ].concat(statusPills(st))),
				E('span', { 'class': 'ob-ver' }, version)
			]);
		}

		// stopHint:挂在「停止」按钮上的悬停提示。内核的「停止」顺带关掉开机自启,
		// 这件事足够反直觉(停完重启路由器,内核不会自己回来),原本用一段说明文字
		// 摆在卡片里,但那段文字太长、占掉半张卡片,已按要求撤掉。信息本身不能跟着
		// 丢,所以改挂 title:不占版面,想知道的人一悬停就有。
		function serviceButtons(name, st, stopActions, stopHint) {
			var stopAttrs = { 'class': 'cbi-button cbi-button-reset',
				'click': ui.createHandlerFn(self, function () { return act(name, stopActions || 'stop'); }) };
			if (stopHint) stopAttrs.title = stopHint;
			return E('div', { 'class': 'ob-btns' }, [
				E('button', { 'class': 'cbi-button cbi-button-apply',
					'click': ui.createHandlerFn(self, function () { return act(name, 'start'); }) }, tr('Start')),
				E('button', stopAttrs, tr('Stop')),
				E('button', { 'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(self, function () { return act(name, 'restart'); }) }, tr('Restart')),
				E('button', { 'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(self, function () {
						return act(name, st.enabled ? 'disable' : 'enable');
					}) }, st.enabled ? tr('Disable autostart') : tr('Enable autostart'))
			]);
		}

		function showUninstallDialog() {
			var purgeBox = E('input', { 'type': 'checkbox', 'id': 'ob-purge' });
			ui.showModal(tr('Uninstall Open-Box'), [
				// 「卸载到底会发生什么」原本写在卸载卡片的说明里,卡片撤掉后这句话
				// 必须跟着搬进来——否则用户点开确认框只剩一句"不可撤销",不知道
				// 撤销的是什么。
				E('p', {}, tr('Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.')),
				E('p', {}, tr('This cannot be undone. Continue?')),
				E('div', { 'style': ROW }, [
					purgeBox,
					E('label', { 'for': 'ob-purge' }, tr('Also delete data (subscriptions, password, rule sets)'))
				]),
				E('p', { 'style': 'opacity:.75;font-size:90%' },
					tr('Keeping data lets a later re-install reuse it. Delete it for a completely fresh start.')),
				E('div', { 'class': 'right', 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button',
						'click': function () { ui.hideModal(); } }, tr('Cancel')),
					E('button', { 'class': 'cbi-button cbi-button-negative',
						'click': ui.createHandlerFn(self, function () {
							var purge = purgeBox.checked === true;
							ui.showModal(tr('Uninstall Open-Box'), [ E('p', { 'class': 'spinning' }, tr('Uninstalling...')) ]);
							return runUninstall(purge).then(function () {
								ui.hideModal();
								ui.addNotification(null, E('p', tr('Uninstalled. Refresh the page; this menu entry will be gone.')), 'info');
							}).catch(function (err) {
								ui.hideModal();
								var msg = String(err && err.message || err);
								if (/not found|No such file/i.test(msg)) {
									msg = tr('Uninstall script not found. Run it manually over SSH.');
									ui.addNotification(null, E('p', msg), 'error');
								} else {
									ui.addNotification(null, E('p', fmt('Uninstall failed: %s', msg)), 'error');
								}
							});
						}) }, tr('Confirm uninstall'))
				])
			]);
		}

		// 更新失败时把日志尾巴摆出来,而不是让用户面对一句"失败了"猜半天——
		// update.sh 的每一步都用 info()/warn()/die() 打了清楚的中文说明,直接展示即可。
		// title 可选,缺省是通用的"更新失败";starting 阶段卡死那条独立分支
		// (handleStartingStuck(),见下方)会传入一个更具体的标题,让用户一眼就能
		// 区分"根本没启动起来"和"启动之后某一步失败了"这两种情况。不管哪种标题,
		// 弹窗结构都一样(消息 + 日志尾巴 + 关闭按钮),必须始终可关闭——这里的
		// 关闭按钮就是那个不变式的落地点。
		function showUpdateFailure(msg, logTail, title) {
			var body = [ E('p', {}, msg) ];
			if (logTail) {
				body.push(E('p', { 'style': 'font-weight:bold;margin:.6em 0 .2em 0' }, tr('Recent update log:')));
				body.push(E('pre', {
					'style': 'max-height:16em;overflow:auto;background:rgba(127,127,127,.08);' +
						'padding:.5em;font-size:85%;white-space:pre-wrap;margin:0'
				}, logTail));
			}
			body.push(E('div', { 'class': 'right', 'style': BTNROW }, [
				E('button', { 'class': 'cbi-button', 'click': function () { ui.hideModal(); } }, tr('Close'))
			]));
			ui.showModal(title || tr('Update failed'), body);
		}

		// 更新走本地脚本(随发布包铺下来的那份,与卸载同理),不依赖外网页面本身
		// 的可用性;总是带 --detach,原因见 runUpdate() 定义处的说明。这里只负责
		// 触发 + 轮询 + 展示进度/结果,真正的下载/校验/换文件全在 update.sh 里。
		// channel 是用户在渠道选择器里选中的渠道('direct' 或某个镜像前缀,见下方
		// CHANNELS),原样透传给 runUpdate()。
		function startUpdate(latestVersion, channel) {
			var progressBody = E('p', { 'class': 'spinning' }, tr('Starting update...'));
			var progressDetailEl = E('p', { 'style': 'margin:.2em 0 0 0;font-size:90%;opacity:.8' }, '');
			var progressBarInner = E('div', {
				'style': 'height:100%;width:0%;background:#2a9d2a;transition:width .3s linear'
			});
			var progressBarOuter = E('div', {
				'style': 'height:6px;background:rgba(127,127,127,.2);border-radius:3px;' +
					'margin:.5em 0;overflow:hidden;display:none'
			}, [ progressBarInner ]);
			// 取消按钮初始隐藏:runUpdate() 的 fs.exec 返回之前,状态文件里可能还是上一次
			// 更新遗留的终态(见 update.sh --detach 分支的说明),这时按不按都没有意义。
			// fs.exec 一返回就开始轮询状态文件,由 applyStatus() 接管这个按钮此后的
			// 显示/隐藏——只要阶段可取消就露出来,不需要在这里预判。
			var cancelBtn = E('button', {
				'class': 'cbi-button cbi-button-negative', 'style': 'display:none',
				'click': ui.createHandlerFn(self, function () { return doCancel(); })
			}, tr('Cancel update'));
			var cancelNote = E('p', {
				'style': 'opacity:.7;font-size:85%;margin:.4em 0 0 0;display:none'
			}, tr('Past this point, cancelling is no longer possible.'));
			var logBox = E('pre', {
				'style': 'max-height:12em;overflow:auto;background:rgba(127,127,127,.08);' +
					'padding:.5em;font-size:85%;white-space:pre-wrap;margin-top:.6em;display:none'
			}, '');
			ui.showModal(fmt('Updating to %s (%s)...', latestVersion, channelLabel(channel)), [
				progressBody, progressDetailEl, progressBarOuter,
				E('div', { 'style': BTNROW }, [ cancelBtn ]), cancelNote,
				logBox
			]);

			var oldVersion = installed;
			var finished = false;
			var progressTimer = null;

			function stopProgressPolling() {
				if (progressTimer != null) {
					window.clearInterval(progressTimer);
					progressTimer = null;
				}
			}

			// 见 UPDATE_PATH 定义处关于 fs.exec XHR 超时根因的说明:runUpdate() 的
			// resolve/reject 不再是任何结论的直接来源,它 reject 时是否该被当成失败,
			// 取决于状态文件有没有留下"这次调用确实碰过 update.sh"的证据。判定办法:
			// 把这次开始轮询时看到的第一份状态当基线(baselineStatus——不管内容是
			// 什么,哪怕是上一次更新遗留的旧终态,或者文件根本不存在/读不到),此后
			// 只要某一次读到了有效内容、且和这份基线不一样(stage/pid/message/bytes
			// 任一个字段不同,或者基线原本读不到而这次读到了),就说明状态文件被
			// 重新写过——不可能是旧文件,因为 --detach 分支同步写 stage=starting 这
			// 一步不依赖 fs.exec 的 XHR 是否收到响应,只要 update.sh 真的被触发过就
			// 会有这次写入。读取失败本身(current 为 null)从不构成证据,无论是刚好
			// 发生在基线之后的第一次失败,还是之前已经能读、这次恰好读不到——那只是
			// 这次会话的 ACL/网络抖了一下,和"这次更新是否真的跑起来过"无关,不能
			// 反过来当成"有证据"。
			var baselineStatus; // undefined = 还没取到第一份基线;之后是 null 或状态对象
			var updateObserved = false;

			function statusChanged(current, baseline) {
				if (current === null) return false;
				if (baseline === null) return true;
				return current.stage !== baseline.stage || current.pid !== baseline.pid ||
					current.message !== baseline.message || current.bytes !== baseline.bytes;
			}

			function noteStatus(statusOrNull) {
				if (baselineStatus === undefined) {
					baselineStatus = statusOrNull;
					return;
				}
				if (!updateObserved && statusChanged(statusOrNull, baselineStatus)) {
					updateObserved = true;
				}
			}

			// 每秒把状态文件里的当前阶段/字节数映射到进度文案 + 进度条 + 取消按钮的
			// 显示状态。committing 及之后的阶段(以及 done/failed/cancelled 这些终态)
			// 都不在 CANCELLABLE_STAGES 里,一旦看到就隐藏取消按钮、露出说明文字——
			// 这就是"取消按钮只在可安全取消的阶段可点"这条要求在页面这一侧的落地点。
			function applyStatus(status) {
				if (finished || !status || !status.stage) return;
				progressBody.textContent = stageText(status);
				var detail = progressDetail(status);
				progressDetailEl.textContent = detail;
				if (status.stage === 'downloading' && status.bytes != null && status.total) {
					var pct = Math.min(100, Math.floor(status.bytes / status.total * 100));
					progressBarOuter.style.display = '';
					progressBarInner.style.width = pct + '%';
				} else {
					progressBarOuter.style.display = 'none';
				}
				var cancellable = CANCELLABLE_STAGES.hasOwnProperty(status.stage);
				if (cancellable) {
					cancelBtn.style.display = '';
					cancelNote.style.display = 'none';
				} else {
					cancelBtn.style.display = 'none';
					cancelNote.style.display = '';
				}
			}

			function doCancel() {
				cancelBtn.disabled = true;
				cancelBtn.textContent = tr('Cancelling...');
				return requestCancel().then(function (word) {
					if (word === 'requested') {
						ui.addNotification(null, E('p', tr('Cancellation requested. The update will stop shortly.')), 'info');
						return;
					}
					if (word === 'committing') {
						ui.addNotification(null, E('p', tr('Already in the replacement stage; cannot cancel now.')), 'info');
					} else {
						ui.addNotification(null, E('p', tr('No update is currently running.')), 'info');
					}
					cancelBtn.style.display = 'none';
					cancelNote.style.display = '';
				}).catch(function (err) {
					ui.addNotification(null, E('p', fmt('Cancel request failed: %s', String(err && err.message || err))), 'error');
					cancelBtn.disabled = false;
					cancelBtn.textContent = tr('Cancel update');
				});
			}

			// starting 阶段卡死的独立安全网(见 STARTING_STUCK_TIMEOUT_MS/
			// isUpdateStartStuck() 定义处的说明):一旦触发,直接把这次更新标记为
			// finished、停止两路轮询、收起进度弹窗,换成一个明确的"启动失败/无响应"
			// 结果弹窗——带日志尾巴,并提示可以改走 SSH。之后 pollForUpdateCompletion()
			// 仍会在后台继续跑到它自己的 8 分钟总超时或某个终态,但那时 finished 已经
			// 是 true,下面 .then(result)/.catch(err) 两个收尾分支都会直接短路跳过,
			// 不会把已经展示给用户的这个结论替换掉。
			function handleStartingStuck() {
				if (finished) return;
				finished = true;
				stopProgressPolling();
				ui.hideModal();
				readUpdateLogTail().then(function (logRes) {
					showUpdateFailure(
						tr('Update did not start. No response after 20 seconds — check the log below, or run the update over SSH instead: sh /opt/open-box/update.sh'),
						logRes.text,
						tr('Update failed to start')
					);
				});
			}

			// 状态文件在这次会话里持续读取失败(见 readUpdateStatus() 顶部关于 LuCI
			// 会话级 ACL 的说明),累计到和"启动卡死"同样的 20 秒阈值后触发——但这和
			// handleStartingStuck() 是两个含义完全不同的结论,不能共用那个"启动失败"
			// 弹窗:那样会把"这次会话看不到状态文件"说成"更新根本没跑起来",而已知
			// 的真实故障恰好是反例——状态文件读取失败,但更新其实一路跑完了。这里换
			// 一个措辞诚实的独立提示(读不到 + 最可能的原因 + SSH 退路),并且刻意不把
			// finished 置真、也不调用 ui.hideModal() 之外的任何东西去打断
			// pollForUpdateCompletion():那条轮询只认版本号和日志正则(见 tick()
			// 里的说明),完全不摸这个状态文件,后面一旦真的检测到版本号变化或日志
			// 里的终态,下面 .then(result)/.catch(err) 两个收尾分支依然会把真正的
			// 结论展示出来,自然替换掉这条"暂时读不到"的提示——两条路径各自只负责
			// 自己那部分结论,不会互相打架、也不会有一个提前把另一个的结论吞掉。
			function handleStatusUnreadable() {
				if (finished) return;
				stopProgressPolling();
				readUpdateLogTail().then(function (logRes) {
					if (finished) return;
					showUpdateFailure(
						tr('Cannot read update progress for this session. The update may still be running in the background — this usually means the LuCI session needs to log in again for newly granted permissions to take effect. You can also check directly over SSH: cat /tmp/openbox-update.status'),
						logRes.text,
						tr('Update progress unavailable')
					);
				});
			}

			var startingElapsedMs = 0;
			var statusReadFailMs = 0;
			var statusUnreadableShown = false;

			// 状态轮询(进度文案/进度条/取消按钮,以及"卡在 starting"/"读不到状态"两路
			// 兜底)在这里立即起跑,和下面触发 fs.exec 的 runUpdate() 完全并行——不再
			// 像旧版那样嵌套在 runUpdate().then() 里等它先 resolve。这就是根因修复
			// 本身的落地点:哪怕这次 fs.exec 的 XHR 迟迟不返回、甚至最终超时 reject,
			// 只要 update.sh 真的被触发了,状态文件的变化照样能被看到、进度照样能
			// 展示、两路兜底也照样能独立生效,不再需要一个单独盯 exec 本身的看门狗。
			readUpdateStatus().then(function (res) {
				noteStatus(res.ok ? res.status : null);
				if (res.ok) applyStatus(res.status);
			});

			progressTimer = window.setInterval(function () {
				readUpdateStatus().then(function (res) {
					if (finished || statusUnreadableShown) return;
					noteStatus(res.ok ? res.status : null);
					if (res.ok) {
						// 这次读到了(不管读到的 stage 是什么):说明状态文件对这次会话
						// 是可读的,之前累积的"读取失败"计时不再成立,归零——只有连续
						// 的读取失败才应该攒够阈值触发 handleStatusUnreadable()。
						statusReadFailMs = 0;
						applyStatus(res.status);
						var stillStarting = !res.status.stage || res.status.stage === 'starting';
						startingElapsedMs = stillStarting ? startingElapsedMs + UPDATE_STATUS_POLL_INTERVAL_MS : 0;
						if (isUpdateStartStuck(res.status, startingElapsedMs)) {
							handleStartingStuck();
						}
						return;
					}
					// 读取本身失败,和"读到了但还没推进"是两回事——不能计入
					// startingElapsedMs,那样会把"这次会话读不到文件"误判成"更新真的
					// 没启动",走 handleStartingStuck() 给出一个错误的"启动失败"结论。
					// 这里单独累计"读取失败"这另一路时长,过阈值后转去
					// handleStatusUnreadable() 展示一个措辞不同、如实反映"读不到"而
					// 不是"失败了"的提示。
					statusReadFailMs += UPDATE_STATUS_POLL_INTERVAL_MS;
					if (statusReadFailMs >= STARTING_STUCK_TIMEOUT_MS) {
						statusUnreadableShown = true;
						handleStatusUnreadable();
					}
				});
			}, UPDATE_STATUS_POLL_INTERVAL_MS);

			var completion = pollForUpdateCompletion(oldVersion, function (logTail) {
				if (logTail) {
					logBox.style.display = '';
					logBox.textContent = logTail;
				}
			});

			// fs.exec 本身的结果现在只是参考信息:resolve 时顺手把文案从"正在启动
			// 更新…"换成"更新已开始…";reject 时——见上面 updateObserved 的说明——
			// 只有在状态文件完全没显示出这次调用碰过 update.sh 时才据此报失败(展示
			// 一个带日志尾巴的失败弹窗,和 handleStartingStuck()/handleStatusUnreadable()
			// 用的是同一个 showUpdateFailure());一旦已经有证据(哪怕只是
			// stage=starting 这一下),就把这次 exec 错误当噪音丢弃(典型即已经在真机
			// 上确认过的"XHR request timed out"),交给上面已经独立跑着的两路轮询给出
			// 真正的结论,永远不会把一次健康的更新报成"更新失败"。
			runUpdate(channel).then(function () {
				if (finished) return;
				progressBody.textContent = tr('Update started. This may take a few minutes (about 80MB to download).');
			}).catch(function (err) {
				if (finished || updateObserved) {
					if (window.console && window.console.debug) {
						window.console.debug('[open-box] fs.exec for update settled with an error, but the ' +
							'status file shows the update is progressing/finished — ignoring it:',
							err && err.message || err);
					}
					return;
				}
				finished = true;
				stopProgressPolling();
				ui.hideModal();
				var msg = String(err && err.message || err);
				if (/not found|No such file/i.test(msg)) {
					ui.addNotification(null, E('p', tr('Update script not found. Run it manually over SSH.')), 'error');
					return;
				}
				readUpdateLogTail().then(function (logRes) {
					showUpdateFailure(fmt('Update failed: %s', msg), logRes.text);
				});
			});

			return completion.then(function (result) {
				if (finished) return; // 已经被别的路径收尾过,这个迟到的结果不再展示
				finished = true;
				stopProgressPolling();
				ui.hideModal();
				if (result.cancelled) {
					ui.addNotification(null, E('p', tr('Update cancelled.')), 'info');
					return;
				}
				if (!result.ok) {
					var failMsg = result.timeout
						? tr('Update timed out. It may still be running in the background; check again shortly.')
						: tr('Update failed.');
					showUpdateFailure(failMsg, result.logTail);
					return;
				}
				if (result.noop) {
					ui.addNotification(null, E('p', tr('Already up to date (no changes made).')), 'info');
					return;
				}
				ui.addNotification(null, E('p', fmt('Update complete: now on %s.', result.version)), 'info');
				window.setTimeout(function () { location.reload(); }, 1200);
			}).catch(function (err) {
				// pollForUpdateCompletion() 按自己的约定始终 resolve、不 reject(见其
				// 定义处的说明),这里只是防御性兜底,正常不会走到。
				if (finished) return;
				finished = true;
				stopProgressPolling();
				ui.hideModal();
				ui.addNotification(null, E('p', fmt('Update failed: %s', String(err && err.message || err))), 'error');
			});
		}

		// 渠道已经在「Open-Box 升级」卡片的下拉框里显式选好了(见下方 CHANNELS/selectedChannel),
		// 这里不再像旧版那样在确认弹窗里二次选择路线,只是把选中渠道当前的探测状态
		// 复述一遍——不然用户在确认这一步完全看不到"这个渠道到底测没测过、测出来
		// 怎么样",容易在一个刚探测失败的渠道上误点确认,白白等一次必然失败的
		// 76MB 下载。
		function showUpdateDialog(latestVersion) {
			var channel = selectedChannel;
			ui.showModal(tr('Confirm update'), [
				E('p', {}, tr('This will stop services and replace program files. The panel will be briefly unavailable. Continue?')),
				E('p', { 'style': 'opacity:.8;font-size:90%;margin:.6em 0 0 0' }, channelStatusText(channel)),
				E('div', { 'class': 'right', 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button',
						'click': function () { ui.hideModal(); } }, tr('Cancel')),
					E('button', { 'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(self, function () { return startUpdate(latestVersion, channel); }) },
						tr('Update now'))
				])
			]);
		}

		// 检查结果作为「Open-Box 升级」的副标题挂在标题后面(.ob-descr,和页面副标题
		// 同一套样式),不再单独占底部一行。
		var versionResult = E('span', { 'class': 'ob-descr' }, '');

		var latestAvailable = null;

		// 「立即更新」常驻可见,靠 disabled 表达"现在没得更新",而不是像旧版那样
		// display:none 整个消失——按钮忽隐忽现会让人以为功能没了,灰着则说明它存在、
		// 只是还不能用(要先「检查更新」)。
		var updateBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'disabled': 'disabled',
			'click': ui.createHandlerFn(self, function () { return showUpdateDialog(latestAvailable); }) },
			tr('Update now'));

		var checkBtn = E('button', { 'class': 'cbi-button cbi-button-neutral',
			'click': ui.createHandlerFn(self, function () {
				versionResult.textContent = tr('Checking...');
				latestAvailable = null;
				updateBtn.disabled = true;
				return checkLatest().then(function (latest) {
					// 读不到已装版本(meta.json 缺失或损坏)时无从比较,但这本身就说明
					// 这套安装是坏的,重装一遍恰恰是修法——所以照样放行,而不是让人
					// 对着一句"发现新版本"和一颗按不动的灰按钮干瞪眼。
					if (!installed || cmpVersion(latest, installed) > 0) {
						versionResult.textContent = fmt('New version available: %s', latest);
						latestAvailable = latest;
					} else {
						versionResult.textContent = tr('Up to date.');
					}
					refreshUpdateControls();
				}).catch(function () {
					versionResult.textContent = tr('Could not check (network unreachable or blocked).');
					refreshUpdateControls();
				});
			}) }, tr('Check for updates'));

		// 一键检测 / 每行「检测」按钮共用的 DOM 挂接:每个渠道一行,exec 逐个发起、
		// 逐个更新(见 probeChannel() 定义处的注释——不是一次 exec 探测全部)。
		var channelRowEls = {};
		// 探测期间要禁用的按钮集合:一键检测按钮本身,加上 4 个渠道各自的「检测」
		// 按钮——不管是"一键检测"链式跑完 4 个,还是单独点某一行,都不希望这期间
		// 还能再点出一次重叠的探测请求。
		var channelBtnEls = {};
		// 单选框本身也要留引用:一键检测跑完会程序化改选"最快的那个渠道",
		// 光改 selectedChannel 变量不够,界面上的圆点也得跟着动。
		var channelRadioEls = {};

		// 渠道行自己一列(.ob-chan-name)已经放了渠道名,这里只再写状态本身——不复述
		// "名称: 结果",那是旧版行挤在窄列里出现的"渠道名+结果"重复,拆宽之后不再需要。
		function applyChanResultClass(el, r) {
			el.classList.remove('ob-chan-ok', 'ob-chan-bad');
			if (r && r.ok === true) el.classList.add('ob-chan-ok');
			else if (r && r.ok === false) el.classList.add('ob-chan-bad');
		}

		function updateChannelRow(value) {
			var el = channelRowEls[value];
			if (!el) return;
			var r = channelResults[value];
			el.textContent = channelStatusSuffix(value);
			el.title = (r && r.ok === false && r.reason) ? r.reason : '';
			applyChanResultClass(el, r);
			refreshUpdateControls();
		}

		// 「检查更新」/「立即更新」能不能点,取决于还有没有走得通的渠道。
		// 只有"四个渠道全测过、且全都不可用"才拦死:一次都没测、或只测挂了一两个,
		// 都不足以替用户断定没路可走——他完全可以不测就直接点检查更新。
		function refreshUpdateControls() {
			var tested = 0, reachable = 0;
			CHANNELS.forEach(function (c) {
				var r = channelResults[c.value];
				if (r && r !== 'pending') { tested++; if (r.ok === true) reachable++; }
			});
			var noRoute = (tested === CHANNELS.length && reachable === 0);
			checkBtn.disabled = noRoute;
			updateBtn.disabled = noRoute || !latestAvailable;
		}

		function probeOneChannel(value) {
			channelResults[value] = 'pending';
			updateChannelRow(value);
			return probeChannel(value).then(function (result) {
				channelResults[value] = result;
				updateChannelRow(value);
			});
		}

		function setProbingDisabled(disabled) {
			probeAllBtn.disabled = disabled;
			CHANNELS.forEach(function (c) {
				var btn = channelBtnEls[c.value];
				if (btn) btn.disabled = disabled;
			});
		}

		function selectChannel(value) {
			selectedChannel = value;
			var radio = channelRadioEls[value];
			if (radio) radio.checked = true;
		}

		// 四个都测完后自动改选延迟最低的那个可用渠道。全都不可用时不动选择——
		// 保留用户原本选中的那个,反正此时「检查更新」「立即更新」已经被
		// refreshUpdateControls() 一起置灰,选谁都无从下手。
		function selectFastestChannel() {
			var best = null;
			CHANNELS.forEach(function (c) {
				var r = channelResults[c.value];
				if (!r || r === 'pending' || r.ok !== true || r.ms == null) return;
				if (best === null || r.ms < best.ms) best = { value: c.value, ms: r.ms };
			});
			if (best) selectChannel(best.value);
		}

		var probeAllBtn = E('button', { 'class': 'cbi-button cbi-button-neutral',
			'click': ui.createHandlerFn(self, function () {
				setProbingDisabled(true);
				var chain = Promise.resolve();
				CHANNELS.forEach(function (c) {
					chain = chain.then(function () { return probeOneChannel(c.value); });
				});
				return chain.then(function () {
					selectFastestChannel();
					setProbingDisabled(false);
				});
			}) }, tr('Test all update channels'));

		var selectedChannel = CHANNELS[0].value;

		// 每行开头一个单选框(.ob-chan-radio,见 STYLE_CSS 定义处):四选一,选中
		// 的渠道就是"立即更新"要用的那个(取代旧版页面顶部单独一个下拉框的做法)。
		// 单选框和渠道名包进同一个 <label> 里,点文字本身也能选中——同时满足
		// 键盘/屏幕阅读器的可达性,不需要另外接 for/id。radio 的 name 相同
		// (ob-channel)让四个输入互斥;默认选中项与旧版下拉框的默认值一致,
		// 都是 CHANNELS[0](GitHub 直连)。
		var channelStatusList = E('div', { 'class': 'ob-chan' },
			CHANNELS.map(function (c, i) {
				var radio = E('input', { 'type': 'radio', 'name': 'ob-channel', 'id': 'ob-chan-radio-' + i });
				radio.checked = (c.value === selectedChannel);
				radio.addEventListener('change', function () {
					selectedChannel = c.value;
				});
				channelRadioEls[c.value] = radio;
				var nameEl = E('span', { 'class': 'ob-chan-name' }, c.label);
				var radioLabel = E('label', { 'class': 'ob-chan-radio', 'for': 'ob-chan-radio-' + i }, [ radio, nameEl ]);
				var statEl = E('span', { 'class': 'ob-chan-stat' }, channelStatusSuffix(c.value));
				channelRowEls[c.value] = statEl;
				var btn = E('button', { 'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(self, function () {
						setProbingDisabled(true);
						return probeOneChannel(c.value).then(function () { setProbingDisabled(false); });
					}) }, tr('Test'));
				channelBtnEls[c.value] = btn;
				return E('div', { 'class': 'ob-chan-row' }, [ radioLabel, statEl, btn ]);
			}));

		return E('div', {}, [
			// 注入的命名空间样式表必须是渲染树的第一个子节点:render() 每次都返回一棵
			// 全新的树(LuCI 用它整体替换视图容器,不是往旧树上打补丁),所以每次渲染
			// 这里都会重新生成、也只生成这一份 <style>,不会在页面里累积出多份。
			E('style', {}, STYLE_CSS),

			// 卸载按钮挂在页面标题行最右侧(.ob-head,定义见 STYLE_CSS),不再是
			// 网格里的第四张卡片:卸载是整个页面级别的破坏性动作,和「内核」「面板」
			// 「升级」这三个日常功能不是一个量级,给它一张同等大小的卡片既抬高了它的
			// 存在感、也在网格里多占一格。真正的说明与二次确认都在
			// showUninstallDialog() 里,这里只留触发点。
			// 说明文字并进标题行、紧跟标题(.ob-h2-left 把两者绑成一组,道理同
			// .ob-h3-left:h2 也是 space-between,平铺会把说明摊到行正中间)。它原本
			// 是标题下面独立的一段 <p>,只为一句话吃掉一整行。
			E('h2', { 'class': 'ob-head' }, [
				E('div', { 'class': 'ob-h2-left' }, [
					E('span', {}, 'Open-Box'),
					// 面板地址跟在副标题末尾:它原本在面板卡片里单独占一行,但那是整个
					// 页面最该被看见的一条信息(完整管理都在面板里),放在副标题里比藏在
					// 第二张卡片中更直接。仍然是可点的链接。文案与链接之间不写空格,靠
					// .ob-descr a 的 margin-left 撑开——中文冒号后跟一个半角空格会显得
					// 松,交给 CSS 控制两种语言下都合适。
					E('span', { 'class': 'ob-descr' }, [
						tr('Basic settings. Full management lives in the Open-Box panel:'),
						E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noreferrer' }, panelUrl)
					])
				]),
				E('button', { 'class': 'cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(self, function () { return showUninstallDialog(); }) },
					tr('Uninstall Open-Box'))
			]),

			// .ob-wrap > .ob-grid 是固定两列、900px 断点收缩成单列的网格(定义见
			// STYLE_CSS),三张自成一体的功能块:第一行 sing-box 内核 + Open-Box
			// 面板,第二行 Open-Box 升级横跨两列(.ob-card-wide,否则右下角会空一格)。
			// DOM 顺序即视觉顺序(CSS 网格按源码顺序逐行填格,不需要额外的
			// grid-area/order 声明)。卸载不在网格里,它在页面标题行右侧。
			E('div', { 'class': 'ob-wrap' }, [
				E('div', { 'class': 'ob-grid' }, [
					// 「停止」本身就会恢复正常上网(init 脚本的 stop_service 会摘掉 Open-Box 写入的
					// dnsmasq 上游、删掉 IPv6 泄漏拦截),所以不再单列一个「紧急停止」按钮——那和
					// 这里的「停止」是同一个动作。把这层保证写成说明挂在按钮下面即可。
					// 内核的「停止」同时关闭开机自启:部署成功会打开自启,若停止不关掉它,坏配置
					// 把网搞断时停了内核、一重启又被拉起来,网再次断掉——那样的「停止」在真正
					// 需要它的场景里是无效的。面板服务不做这件事:面板是唯一的管理入口,它应该
					// 在重启后自己回来。
					//
					// 「sing-box 内核」这张卡片是一个自成一体的功能块:状态/控制在上,内核
					// 版本 + 升级说明在下——内核版本号来自 meta.json 的 singboxVersion(构建期
					// 钦定值,见 readInstalledSingboxVersion() 的注释),并且这里刻意不放一个
					// 独立的"升级内核"按钮:内核版本与 Open-Box 发行版本是绑定发布的,配置是
					// 照着这个确切内核版本生成的,独立升级内核有打破这层对应关系、生成的配置被
					// 新内核拒绝启动的风险。升级入口统一指向下面「Open-Box 升级」卡片里的
					// 「立即更新」——内核随整个发行版本一起换。
					E('div', { 'class': 'ob-card' }, [
						// 版本号右对齐放在标题行里:它本来是卡片底部一行带标签的
						// 「内核版本: x.y.z」,加一条分隔线和一段说明。标签、分隔线、
						// 说明都是冗余的——内核卡片里没有升级入口,升级统一在
						// 「Open-Box 升级」卡片,这层关系不必再用文字重复一遍。
						cardTitle(tr('sing-box core'), core, singboxVersion || tr('Not installed')),
						serviceButtons('openbox', core, [ 'stop', 'disable' ],
							tr('Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.'))
					]),

					// 「Open-Box 面板」卡片同理是一个自成一体的功能块:标题行是标题 + 状态
					// 徽标 + 版本号,下面是启停控制。渠道选择、探测与升级操作篇幅大、也不是
					// "这张卡片自己的版本信息",单独成一张紧跟在后面的「Open-Box 升级」卡片
					// (见下方),不再像旧版那样挤进面板卡片里。面板地址也不在这里了——它
					// 挪到了页面副标题(见上方 .ob-descr)。
					E('div', { 'class': 'ob-card' }, [
						cardTitle(tr('Open-Box panel'), panel, installed || tr('Not installed')),
						serviceButtons('openbox-panel', panel, null)
					]),

					// 「Open-Box 升级」独立成一张卡片(负责人手绘草图的要求):标题行右侧是
					// 整张卡片就两部分:一行标题(左边标题 + 检查结果副标题,右边
					// 「一键检测可用升级渠道 / 检查更新 / 立即更新」三个按钮),下面 4 个
					// 渠道各自成块、并排一行。每块里是单选钮 + 渠道名 + 探测状态 + 单独的
					// 「检测」按钮——选中的那个就是"立即更新"要用的渠道(取代旧版页面顶部
					// 那个下拉框)。原先卡片底部还有一行"选中渠道的实时状态",那是渠道行
					// 挤在窄列里、状态不好读时的补丁;渠道拆成横排大块之后每块自己就写着
					// 状态,那一行纯属重复,连同它上面的分隔线一起撤掉。
					E('div', { 'class': 'ob-card ob-card-wide' }, [
						// 三个按钮必须裹进 .ob-h3-right:h3 是 justify-content:space-between,
						// 平铺进来的多个子元素会被逐个摊开,变成"标题…按钮…按钮…按钮",而不是
						// "三个按钮挨在一起靠右"。左侧的标题 + 结果副标题同理裹进 .ob-h3-left。
						E('h3', {}, [
							E('div', { 'class': 'ob-h3-left' }, [
								E('span', {}, tr('Open-Box upgrade')),
								versionResult
							]),
							E('div', { 'class': 'ob-h3-right' }, [ probeAllBtn, checkBtn, updateBtn ])
						]),
						channelStatusList
					])
				])
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
