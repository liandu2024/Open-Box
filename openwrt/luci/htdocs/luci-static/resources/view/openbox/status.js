'use strict';
'require view';
'require rpc';
'require ui';

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

function serviceState(name) {
	return callInitList(name).then(function (res) {
		var entry = res[name] || {};
		return { enabled: entry.enabled === true, running: entry.running === true };
	}).catch(function () {
		return { enabled: false, running: false };
	});
}

function act(name, action) {
	return callInitAction(name, action).then(function () {
		ui.addNotification(null, E('p', _('Action sent: %s %s').format(name, action)), 'info');
		window.setTimeout(function () { location.reload(); }, 1200);
	}).catch(function (err) {
		ui.addNotification(null, E('p', _('Action failed: %s').format(err.message || err)), 'error');
	});
}

return view.extend({
	load: function () {
		return Promise.all([ serviceState('openbox'), serviceState('openbox-panel') ]);
	},

	render: function (data) {
		var core = data[0], panel = data[1];
		var panelUrl = 'http://' + window.location.hostname + ':2026';

		function serviceRow(title, name, st) {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, title),
				E('p', {}, [
					E('span', {}, _('Status') + ': '),
					E('strong', { 'style': st.running ? 'color:#2a9d2a' : 'color:#c33' },
						st.running ? _('running') : _('stopped')),
					E('span', {}, '  |  ' + _('Autostart') + ': '),
					E('strong', {}, st.enabled ? _('on') : _('off'))
				]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(this, function () { return act(name, 'start'); }) }, _('Start')),
					' ',
					E('button', { 'class': 'cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(this, function () { return act(name, 'stop'); }) }, _('Stop')),
					' ',
					E('button', { 'class': 'cbi-button',
						'click': ui.createHandlerFn(this, function () { return act(name, 'restart'); }) }, _('Restart')),
					' ',
					E('button', { 'class': 'cbi-button',
						'click': ui.createHandlerFn(this, function () {
							return act(name, st.enabled ? 'disable' : 'enable');
						}) }, st.enabled ? _('Disable autostart') : _('Enable autostart'))
				])
			]);
		}

		return E('div', {}, [
			E('h2', {}, _('Open-Box')),
			E('p', { 'class': 'cbi-section-descr' },
				_('Fallback controls. Full management lives in the Open-Box panel.')),

			serviceRow.call(this, _('sing-box core'), 'openbox', core),
			serviceRow.call(this, _('Open-Box panel'), 'openbox-panel', panel),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Emergency')),
				E('p', {}, _('Stops the core and restores plain internet access (removes the IPv6 leak block and the dead DNS upstream). The panel stays reachable.')),
				E('button', { 'class': 'cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, function () { return act('openbox', 'stop'); }) },
					_('Emergency stop / restore direct'))
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Panel')),
				E('p', {}, E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noreferrer' }, panelUrl))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
