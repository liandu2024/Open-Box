<template>
  <!-- 规则页顶上的访问路径:左边「规则路由」按查询条件推算,右边「真实路由」是一次真实的测试。
       右边有两种测法:默认「模拟终端」——面板在路由器上建一台虚拟 LAN 终端(独立网络命名空间 + veth 接到 LAN
       网桥 + DHCP 取址),让它像普通设备一样问 LAN 的 DNS、从 LAN 入口进入路由器,入口旁路还是进内核由实际入口
       规则决定,并给出系统转发证据;「内核诊断」是原来的回环 mixed 入站测试,只看内核内部的分流,不经过 LAN 入口。
       设备不具备模拟条件时如实提示,不悄悄退回内核诊断。
       两列都是同一套五站、自下而上(① 发起访问 → ⑤ 最终出口),同一站左右同一行。
       整块是一个网格:桌面两列,每一行是同一站的左右两格,所以展开详情时另一列同一站跟着变高、始终对齐;
       窄屏改成单列,按 --m-order 先排完左列再排右列,各自还是从下往上。 -->
  <!-- text-sm:整块的基准字号,大字(font-medium)、ProxyName / ProxyGroupNow 的名字和 16px 图标都按它对齐 -->
  <div class="route-grid grid grid-cols-1 gap-x-3 text-sm md:grid-cols-2">
        <!-- 列头:左 = 规则路由 · 依据查询条件推算;右 = 真实路由 · 模拟终端 / 内核诊断 -->
        <!-- 列头:图标放在站号圆圈那一列、和圆圈同大;标题从各站文字的左边缘起(pl-12),上下对齐 -->
        <div
          class="route-cell route-head relative flex items-start gap-2 border-x border-t pr-3 pl-12 pt-3 pb-2.5"
          :style="{ '--m-order': 0 }"
        >
          <MapIcon class="route-head-icon text-base-content/50" />
          <div class="min-w-0">
            <!-- 标题后面紧跟状态徽章(推算 / 实测的总体结果) -->
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ $t('ruleLookupTitle') }}</span>
              <span
                class="badge badge-sm whitespace-nowrap"
                :class="toneClass(rulePill.tone)"
              >
                <span
                  v-if="ruleLoading"
                  class="loading loading-spinner loading-xs"
                />
                <template v-else>{{ rulePill.text }}</template>
              </span>
            </div>
            <div class="text-base-content/50 text-xs">{{ $t('routeCmpRuleSub') }}</div>
          </div>
        </div>
        <div
          class="route-cell route-head relative mt-2 flex items-start gap-2 border-x border-t pr-3 pl-12 pt-3 pb-2.5 md:mt-0"
          :style="{ '--m-order': 10 }"
        >
          <BoltIcon class="route-head-icon text-base-content/50" />
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ $t('routeTestTitle') }}</span>
              <span
                class="badge badge-sm whitespace-nowrap"
                :class="toneClass(actualPill.tone)"
              >
                <span
                  v-if="actualLoading"
                  class="loading loading-spinner loading-xs"
                />
                <template v-else>{{ actualPill.text }}</template>
              </span>
            </div>
            <div class="text-base-content/50 text-xs">{{ mode === 'terminal' ? $t('routeCmpTerminalSub') : $t('routeCmpActualSub') }}</div>
          </div>
          <!-- 测法切换 + 重新测试,靠右 -->
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                :class="mode === 'terminal' ? 'btn-active' : 'btn-ghost'"
                :disabled="actualLoading"
                :title="$t('routeCmpTerminalSub')"
                @click="switchMode('terminal')"
              >{{ $t('routeModeTerminal') }}</button>
              <button
                type="button"
                class="btn btn-xs join-item"
                :class="mode === 'kernel' ? 'btn-active' : 'btn-ghost'"
                :disabled="actualLoading"
                :title="$t('routeModeKernelHint')"
                @click="switchMode('kernel')"
              >{{ $t('routeModeKernel') }}</button>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="actualLoading"
              :title="$t('routeTestRerun')"
              @click="runActual"
            >
              <ArrowPathIcon class="h-3.5 w-3.5" />
              <span class="hidden sm:inline">{{ $t('routeTestRerun') }}</span>
            </button>
          </div>
        </div>

        <!-- ⑤ 最终出口 -->
        <RouteStage
          :index="5"
          side="left"
          :mobile-order="1"
          :label="$t('routeStageExit')"
          :state="ruleExit.state"
          :badge="ruleExit.badge"
          :badge-tone="ruleExit.tone"
          :details-title="$t('routeStageDetails')"
          last
        >
          <template v-if="ruleError">
            <span class="text-error text-xs">{{ ruleError }}</span>
          </template>
          <template v-else-if="!rule">
            <span class="text-base-content/50 text-xs">{{ $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else-if="ruleExit.state === 'pending'">
            <span class="font-medium">{{ $t('routeExitPending') }}</span>
            <span class="text-base-content/60 text-xs">{{ $t('routeExitPendingSub') }}</span>
          </template>
          <template v-else-if="ruleReject">
            <span class="text-error inline-flex items-center gap-1 font-medium"><NoSymbolIcon class="h-4 w-4" />{{ $t('routeExitBlocked') }}</span>
          </template>
          <template v-else-if="ruleOutbound">
            <div class="flex flex-wrap items-center gap-2">
              <ProxyGroupNow
                v-if="proxyMap[ruleOutbound]?.now"
                :name="ruleOutbound"
                include-self
              />
              <ProxyName
                v-else-if="proxyMap[ruleOutbound]"
                :name="ruleOutbound"
                class="font-medium"
              />
              <span
                v-else
                class="font-medium"
              >{{ ruleOutbound }}</span>
            </div>
          </template>
          <template v-else>
            <span class="text-base-content/50 text-xs">{{ $t('routeEntryUnknown') }}</span>
          </template>
          <template
            v-if="rule?.chainError"
            #details
          >
            <p class="route-note">{{ $t('penetrationChainError', { message: rule.chainError }) }}</p>
          </template>
        </RouteStage>
        <RouteStage
          :index="5"
          side="right"
          :mobile-order="11"
          :label="$t('routeStageExitActual')"
          :state="actualExit.state"
          :badge="actualExit.badge"
          :badge-tone="actualExit.tone"
          :details-title="$t('routeExitDetails')"
          last
        >
          <template v-if="actualError">
            <span class="text-error text-xs">{{ actualError }}</span>
          </template>
          <template v-else-if="!hasResult">
            <span class="text-base-content/50 text-xs">{{ placeholderText }}</span>
          </template>
          <template v-else>
            <!-- 链路(或"系统转发")、HTTP 状态、结果文字放在同一个行盒里;目标 IP / 来源端口 / IPv6 结果 / 节点怎么连进「连接详情」 -->
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <template v-if="exitView.forward">
                <span class="font-medium">{{ $t('routeTermExitForward') }}</span>
                <span class="text-base-content/60 text-xs">{{ $t('routeTermExitForwardVia', { device: exitView.forward.device, gateway: exitView.forward.gateway }) }}</span>
              </template>
              <template v-else-if="exitView.chains.length">
                <template
                  v-for="(hop, i) in exitView.chains"
                  :key="`${hop}-${i}`"
                >
                  <ArrowRightCircleIcon
                    v-if="i > 0"
                    class="text-base-content/40 -ml-0.5 h-4 w-4 shrink-0"
                  />
                  <ProxyName :name="hop" />
                </template>
              </template>
              <span
                v-else
                class="text-base-content/50 text-xs"
              >{{ $t('routeExitChainUnknown') }}</span>
              <span
                v-if="exitView.status !== undefined"
                class="badge badge-sm"
                :class="toneClass(statusTone(exitView.status))"
              >HTTP {{ exitView.status }}</span>
              <span
                v-if="exitView.status !== undefined"
                class="text-base-content/70 text-xs"
              >{{ statusText(exitView.status) }}</span>
              <span
                v-if="exitView.error"
                class="text-error text-xs"
              >{{ $t('routeTestRequestFailed', { message: errorText(exitView.error) }) }}</span>
            </div>
          </template>
          <template
            v-if="hasResult && !actualError && exitDetails.length"
            #details
          >
            <p
              v-for="(d, i) in exitDetails"
              :key="`${i}-${d.text}`"
              :class="[d.mono ? 'font-mono' : '', d.warn ? 'route-note' : '']"
            >{{ d.text }}</p>
          </template>
        </RouteStage>

        <!-- ④ 规则匹配 -->
        <RouteStage
          :index="4"
          side="left"
          :mobile-order="2"
          :label="$t('routeStageRule')"
          :state="ruleMatch.state"
          :badge="ruleMatch.badge"
          :badge-tone="ruleMatch.tone"
          :details-title="$t('routeRuleDetail')"
        >
          <template v-if="!rule || ruleError">
            <span class="text-base-content/50 text-xs">{{ ruleError ? '—' : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else-if="rule.matchError">
            <span class="font-medium">{{ $t('penetrationRuleUnknown') }}</span>
            <span class="text-base-content/60 text-xs">{{ rule.matchError }}</span>
          </template>
          <template v-else-if="rule.matched">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-base-content/60 text-xs">{{ $t('ruleLookupSiteSet') }}</span>
              <span
                v-if="ruleOwner"
                class="font-medium"
              >{{ ruleOwner }}</span>
              <ProxyName
                v-else-if="ruleOutbound"
                :name="ruleOutbound"
                class="font-medium"
              />
              <span
                v-if="ruleReject"
                class="badge badge-sm badge-error badge-soft"
              >{{ $t('penetrationBlockedTitle') }}</span>
            </div>
            <!-- 具体命中的第一条条目跟在站点集后面;完整条件和全部条目在「规则详情」里 -->
            <template v-if="firstEntry">
              <span class="badge badge-sm badge-ghost font-mono">{{ typeLabel(firstEntry.type) }}</span>
              <span class="text-main font-mono text-xs">{{ firstEntry.value }}</span>
              <span class="text-base-content/50 text-xs">{{ firstEntry.source === 'custom' ? $t('ruleSourceCustom') : firstEntry.source }}</span>
            </template>

          </template>
          <template v-else>
            <span class="font-medium">{{ $t('routeRuleNoMatchFallback') }}</span>

          </template>
          <template
            v-if="rule && !ruleError && !rule.matchError && (rule.matched || rule.routingStale || ruleAssumptions.relevant.length || ruleAssumptions.same.length)"
            #details
          >
            <!-- 分流改了内核还没重启:推算和下面的实测会对不上,放在详情里说明,主行只留结果 -->
            <p
              v-if="rule.routingStale"
              class="route-note"
            >{{ $t('ruleLookupRoutingStale') }}</p>
            <template v-if="rule.matched">
              <p class="text-base-content/50 font-mono text-[11px] break-all">{{ conditionText }}</p>
              <!-- 第一条已经跟在站点集后面显示了,这里只列其余的 -->
              <div
                v-for="(e, i) in (rule.matched?.entries || []).slice(1, 9)"
                :key="`${e.source}-${e.type}-${e.value}-${i}`"
                class="flex flex-wrap items-center gap-x-2"
              >
                <span class="badge badge-sm badge-ghost font-mono">{{ typeLabel(e.type) }}</span>
                <span class="text-main font-mono">{{ e.value }}</span>
                <span class="text-base-content/50">{{ e.source === 'custom' ? $t('ruleSourceCustom') : e.source }}</span>
              </div>
              <p v-if="(rule.matched?.entriesTotal || 0) > 9">{{ $t('ruleLookupMoreEntries', { count: (rule.matched?.entriesTotal || 0) - 9 }) }}</p>
            </template>
            <!-- 推算时按"不满足它"跳过的规则(要看终端来源 / 端口 / 地址族而查询没给):会改变出口的用提示框,和结果一样的一句带过 -->
            <p
              v-for="line in ruleAssumptions.relevant"
              :key="line"
              class="route-note"
            >{{ line }}</p>
            <p
              v-for="line in ruleAssumptions.same"
              :key="line"
            >{{ line }}</p>
          </template>
        </RouteStage>
        <RouteStage
          :index="4"
          side="right"
          :mobile-order="12"
          :label="$t('routeStageRule')"
          :state="actualRule.state"
          :badge="actualRule.badge"
          :badge-tone="actualRule.tone"
          :details-title="$t('routeRuleDetail')"
        >
          <template v-if="!hasResult || actualError">
            <span class="text-base-content/50 text-xs">{{ placeholderText }}</span>
          </template>
          <!-- 命中入口旁路:没进内核,这一站整个跳过 -->
          <template v-else-if="ruleView.skipped">
            <span class="text-base-content/60 font-medium">{{ $t('routeTermRuleSkippedText') }}</span>
          </template>
          <template v-else-if="ruleView.notSeen">
            <span class="font-medium">{{ $t('routeTermRuleNotSeen') }}</span>
          </template>
          <!-- 和左列同一个结构:第一行"连接归属 + 站点集名"(对应左列的"站点集 + 名字"),内核的规则原文在「规则详情」里 -->
          <template v-else-if="ruleView.owner || ruleView.rule">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-base-content/60 text-xs">{{ $t('routeRuleOwnerLabel') }}</span>
              <ProxyName
                v-if="ruleView.owner && proxyMap[ruleView.owner]"
                :name="ruleView.owner"
                class="font-medium"
              />
              <span
                v-else-if="ruleView.owner"
                class="font-medium"
              >{{ ruleView.owner }}</span>
              <span
                v-else
                class="text-base-content/50 text-xs"
              >{{ $t('routeEntryUnknown') }}</span>
            </div>
          </template>
          <template v-else>
            <span class="text-base-content/50 text-xs">{{ $t('routeTestRuleUnknown') }}</span>
          </template>
          <template
            v-if="hasResult && !actualError && !ruleView.skipped"
            #details
          >
            <p
              v-if="ruleView.rule"
              class="text-base-content/50 font-mono text-[11px] break-all"
            >{{ ruleView.rule }}</p>
            <p v-else>{{ $t('routeRuleNoIndex') }}</p>
            <p>{{ $t('routeRuleDiffBody') }}</p>
          </template>
        </RouteStage>

        <!-- ③ 业务入口 -->
        <RouteStage
          :index="3"
          side="left"
          :mobile-order="3"
          :label="$t('routeStageEntry')"
          :state="ruleEntry.state"
          :badge="rule ? $t('routeEntryConfigPredicted') : undefined"
          badge-tone="muted"
          :details-title="$t('routeEntryReason')"
        >
          <template v-if="!rule || ruleError">
            <span class="text-base-content/50 text-xs">{{ ruleError ? '—' : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ ruleEntry.value }}</span>
            <span class="text-base-content/60 text-xs">{{ ruleEntry.sub }}</span>
          </template>
          <template
            v-if="ruleEntry.detail"
            #details
          >
            <p>{{ ruleEntry.detail }}</p>
          </template>
        </RouteStage>
        <RouteStage
          :index="3"
          side="right"
          :mobile-order="13"
          :label="$t('routeStageEntry')"
          :state="actualEntry.state"
          :badge="actualEntry.badge"
          :badge-tone="actualEntry.tone"
          :details-title="mode === 'terminal' ? $t('routeTermEvidence') : $t('routeEntryInboundDiff')"
        >
          <template v-if="!hasResult || actualError">
            <span class="text-base-content/50 text-xs">{{ placeholderText }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ actualEntry.value }}</span>
            <span class="text-base-content/60 text-xs">{{ actualEntry.sub }}</span>
          </template>
          <!-- 模拟终端:列出这条连接的系统转发证据(conntrack 原文、路由查询、NAT、nft 旁路集合、内核连接表) -->
          <template
            v-if="hasResult && !actualError && (mode === 'terminal' ? entryEvidence.length > 0 : !dnsSkipped)"
            #details
          >
            <template v-if="mode === 'terminal'">
              <p
                v-for="(e, i) in entryEvidence"
                :key="`${i}-${e.text}`"
                :class="[e.mono ? 'font-mono text-[11px]' : '', e.warn ? 'route-note' : '']"
              ><span
                v-if="e.label"
                class="text-base-content/50 mr-1"
              >{{ e.label }}</span>{{ e.text }}</p>
            </template>
            <p v-else>{{ $t('routeTestDomainTargetNote') }}</p>
          </template>
        </RouteStage>

        <!-- ② DNS 解析 -->
        <RouteStage
          :index="2"
          side="left"
          :mobile-order="4"
          :label="$t('routeStageDns')"
          :state="ruleDns.state"
          :badge="ruleDns.badge"
          :badge-tone="ruleDns.tone"
          :details-title="$t('routeDnsRuleDetail')"
        >
          <template v-if="!rule || ruleError">
            <span class="text-base-content/50 text-xs">{{ ruleError ? '—' : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else-if="ruleDns.kind === 'skip'">
            <span class="font-medium">{{ $t('routeDnsNone') }}</span>
            <span class="text-base-content/60 text-xs">{{ $t('routeDnsNoneSub', { kind: kindText }) }}</span>
          </template>
          <template v-else-if="ruleDns.kind === 'error'">
            <span class="font-medium">{{ $t('routeDnsUnknown') }}</span>
            <span class="text-base-content/60 text-xs">{{ ruleDns.message }}</span>
          </template>
          <template v-else-if="ruleDns.kind === 'reject'">
            <span class="badge badge-sm badge-error badge-soft w-fit">{{ $t('penetrationBlockedTitle') }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ ruleDns.rewrite ? $t('routeDnsRewrite') : ruleDns.viaProxy ? $t('routeTestDnsProxy') : $t('routeTestDnsDirect') }}</span>
            <span class="text-base-content/60 font-mono text-xs">{{ ruleDns.serverLine }}</span>
            <span
              v-if="ruleDns.rewrite"
              class="basis-full text-xs"
            >{{ ruleDns.rewrite }}</span>
          </template>
          <template
            v-if="ruleDns.kind === 'decision'"
            #details
          >
            <p><span class="text-base-content/50">{{ $t('routeDnsResolver') }}</span> <span class="font-mono">{{ ruleDns.tag }}</span></p>
            <div
              v-if="ruleDns.detour"
              class="flex flex-wrap items-center gap-x-1.5"
            >
              <span class="text-base-content/50">{{ $t('routeDnsPolicyVia') }}</span>
              <ProxyName :name="ruleDns.detour" />
            </div>
            <p>{{ $t('routeDnsTerminalNote') }}</p>
            <p
              v-for="line in ruleDns.assumptions || []"
              :key="line"
              class="route-note"
            >{{ line }}</p>
            <p
              v-for="line in ruleDns.assumptionsSame || []"
              :key="line"
            >{{ line }}</p>
          </template>
        </RouteStage>
        <RouteStage
          :index="2"
          side="right"
          :mobile-order="14"
          :label="$t('routeStageDns')"
          :state="actualDns.state"
          :badge="actualDns.badge"
          :badge-tone="actualDns.tone"
          :details-title="$t('routeDnsRecords')"
          details-inline
        >
          <template v-if="!hasResult || actualError">
            <span class="text-base-content/50 text-xs">{{ placeholderText }}</span>
          </template>
          <template v-else-if="actualDns.kind === 'skip'">
            <span class="font-medium">{{ $t('routeDnsNone') }}</span>
            <span class="text-base-content/60 text-xs">{{ $t('routeDnsNoneSub', { kind: kindText }) }}</span>
          </template>
          <template v-else-if="actualDns.kind === 'error'">
            <span class="font-medium">{{ $t('routeDnsUnknown') }}</span>
            <span class="text-base-content/60 text-xs">{{ actualDns.message }}</span>
          </template>
          <template v-else-if="actualDns.kind === 'reject'">
            <span class="badge badge-sm badge-error badge-soft w-fit">{{ $t('penetrationBlockedTitle') }}</span>
          </template>
          <template v-else>
            <!-- 模拟终端问的是 LAN 的 DNS(DHCP 发下来的那台);内核诊断是内核自己的直连 / 代理解析器 -->
            <span class="font-medium">{{ actualDns.label || (actualDns.lan ? $t('routeTermDnsLan') : actualDns.rewrite ? $t('routeDnsRewrite') : actualDns.viaProxy ? $t('routeTestDnsProxy') : $t('routeTestDnsDirect')) }}</span>
            <span class="text-base-content/60 font-mono text-xs">{{ actualDns.serverLine }}</span>
            <span
              v-if="actualDns.rewrite"
              class="basis-full text-xs"
            >{{ actualDns.rewrite }}</span>
            <!-- IPv4 / IPv6 分开说、排在第二行:v4 成功了不能因为 AAAA 为空写成"没有解析结果";
                 档案没开 IPv6 的"未查询"不占这一行,放进解析记录里 -->
            <span
              class="basis-full"
              aria-hidden="true"
            />
            <span
              v-if="actualDns.v4"
              class="text-xs"
              :class="actualDns.v4.tone === 'pending' ? 'text-base-content/80 font-medium' : actualDns.v4.tone === 'good' ? 'text-success' : 'text-base-content/60'"
            >{{ actualDns.v4.text }}</span>
            <span
              v-if="actualDns.v6 && actualDns.v6.queried"
              class="text-xs"
              :class="actualDns.v6.tone === 'pending' ? 'text-base-content/80 font-medium' : actualDns.v6.tone === 'good' ? 'text-success' : 'text-base-content/60'"
            >· {{ actualDns.v6.text }}</span>
            <!-- 模拟终端:LAN DNS 只是第一层,下一层(进内核后交给谁、经哪个节点问的)从内核日志截出来单独一行 -->
            <span
              v-if="actualDns.kernelLine"
              class="basis-full"
              aria-hidden="true"
            />
            <span
              v-if="actualDns.kernelLine"
              class="text-xs"
              :class="actualDns.kernelWarn ? 'text-warning font-medium' : 'text-base-content/80'"
            >{{ actualDns.kernelLine }}</span>
          </template>
          <template
            v-if="actualDns.kind === 'decision'"
            #details
          >
            <p
              v-if="actualDns.stale"
              class="route-note"
            >{{ actualDns.stale }}</p>
            <p v-if="actualDns.v6 && !actualDns.v6.queried">{{ actualDns.v6.text }}</p>
            <p v-if="actualDns.tag"><span class="text-base-content/50">{{ $t('routeDnsResolver') }}</span> <span class="font-mono">{{ actualDns.tag }}</span></p>
            <div
              v-if="actualDns.chain?.length"
              class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
            >
              <span class="text-base-content/50">{{ $t('routeDnsPolicyVia') }}</span>
              <template
                v-for="(hop, i) in actualDns.chain"
                :key="`${hop}-${i}`"
              >
                <ArrowRightCircleIcon
                  v-if="i > 0"
                  class="text-base-content/40 h-4 w-4 shrink-0"
                />
                <ProxyName :name="hop" />
              </template>
            </div>
            <p
              v-for="note in actualDns.notes || []"
              :key="note.text"
              :class="note.warn ? 'route-note' : ''"
            >{{ note.text }}</p>
            <p
              v-for="line in actualDns.assumptions || []"
              :key="line"
              class="route-note"
            >{{ line }}</p>
            <p
              v-for="line in actualDns.assumptionsSame || []"
              :key="line"
            >{{ line }}</p>
            <div
              v-if="actualDns.answers?.length"
              class="flex flex-wrap items-center gap-1"
            >
              <span class="text-base-content/50">A</span>
              <span
                v-for="ip in actualDns.answers"
                :key="ip"
                class="badge badge-sm badge-ghost font-mono"
              >{{ ip }}</span>
            </div>
            <div
              v-if="actualDns.answers6?.length"
              class="flex flex-wrap items-center gap-1"
            >
              <span class="text-base-content/50">AAAA</span>
              <span
                v-for="ip in actualDns.answers6"
                :key="'6' + ip"
                class="badge badge-sm badge-outline font-mono"
              >{{ ip }}</span>
            </div>
          </template>
        </RouteStage>

        <!-- ① 发起访问 -->
        <RouteStage
          :index="1"
          side="left"
          :mobile-order="5"
          :label="$t('routeStageStart')"
          :badge="kindText"
          badge-tone="muted"
          first
        >
          <span class="font-mono font-medium break-all">{{ target }}</span>
          <span class="text-base-content/60 basis-full text-xs">{{ $t('routeStartSourceUnspecified') }} · {{ port ? $t('routeStartPort', { port }) : $t('routeStartPortUnspecified') }}</span>
        </RouteStage>
        <RouteStage
          :index="1"
          side="right"
          :mobile-order="15"
          :label="$t('routeStageStart')"
          :state="termBlock ? 'pending' : 'ok'"
          :badge="kindText"
          badge-tone="muted"
          :details-title="$t('routeStartSourceTitle')"
          first
        >
          <!-- 设备不具备模拟条件 / 虚拟终端没建起来:在这一站(测试来源)说清楚,并给出改用内核诊断的按钮,不自动退回 -->
          <template v-if="termBlock">
            <span class="font-medium">{{ termBlock.kind === 'incapable' ? $t('routeTermNotCapable') : $t('routeTermSetupFailed') }}</span>
            <span class="text-base-content/60 basis-full text-xs">{{ termBlock.kind === 'incapable' ? $t('routeTermNotCapableSub', { missing: missingText }) : termBlock.message }}</span>
            <span class="text-base-content/60 basis-full text-xs">{{ $t('routeTermNoFallbackNote') }}</span>
            <button
              type="button"
              class="btn btn-outline btn-xs"
              @click="switchMode('kernel')"
            >{{ $t('routeTermUseKernel') }}</button>
          </template>
          <template v-else-if="mode === 'terminal'">
            <span class="font-medium">{{ terminal?.source ? $t('routeStartVirtual', { name: terminal.source.name }) : $t('routeModeTerminal') }}</span>
            <span class="text-base-content/60 font-mono text-xs break-all">{{ terminal?.exit?.url || `${target}${port ? `:${port}` : ''}` }}</span>
            <span class="text-base-content/60 basis-full text-xs">{{ terminal?.source ? $t('routeStartVirtualSub', { ip: terminal.source.ip }) : $t('routeStartVirtualPending') }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ $t('routeStartPanel') }}</span>
            <span
              v-if="actual?.exit.url"
              class="text-base-content/60 font-mono text-xs break-all"
            >{{ actual.exit.url }}</span>
            <span
              v-else
              class="text-base-content/60 text-xs"
            >{{ target }}{{ port ? `:${port}` : '' }}</span>
          </template>
          <template #details>
            <template v-if="mode === 'terminal'">
              <p>{{ $t('routeStartVirtualDetail') }}</p>
              <p
                v-if="terminal?.source"
                class="font-mono"
              >{{ $t('routeStartVirtualLease', { mac: terminal.source.mac, gateway: terminal.source.gateway, dns: terminal.source.dns.join(' ') }) }}</p>
            </template>
            <template v-else>
              <p>{{ $t('routeStartPanelDetail') }}</p>
              <p>{{ $t('routeModeKernelHint') }}</p>
              <p
                v-if="actual?.context"
                class="route-note"
              >{{ $t('routeTestSourceNotProbed', { ip: actual.context.sourceIp }) }}</p>
            </template>
          </template>
        </RouteStage>

  </div>
</template>

<script lang="ts">
import type { OpenboxTerminalCapability } from '@/api/openbox'
// 设备能力只问一次(同一次会话里不会变),各个查询共用
let capabilityPromise: Promise<OpenboxTerminalCapability> | null = null
</script>

<script setup lang="ts">
import type { OpenboxDnsAssumption, OpenboxPenetrationResult, OpenboxRouteTest, OpenboxRuleAssumption, OpenboxTerminalEntry, OpenboxTerminalMissing, OpenboxTerminalTest } from '@/api/openbox'
import { fetchTerminalCapability, queryPenetration, testRoute, testTerminal } from '@/api/openbox'
import ProxyGroupNow from '@/components/proxies/ProxyGroupNow.vue'
import ProxyName from '@/components/proxies/ProxyName.vue'
import RouteStage from '@/components/rules/RouteStage.vue'
import type { RouteStageState, RouteStageTone } from '@/components/rules/RouteStage.vue'
import { ruleTypeLabelKey } from '@/helper/ruleType'
import { proxyMap } from '@/store/proxies'
import { ArrowPathIcon, ArrowRightCircleIcon, BoltIcon, MapIcon, NoSymbolIcon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// target 是拿去查规则 / DNS 的主机名;port 只给真实访问用
const props = defineProps<{ target: string; port?: number | null }>()
const emit = defineEmits<{ matched: [index: number | null] }>()
const { t } = useI18n()

// ---------- 规则路由(推算) ----------
const rule = ref<OpenboxPenetrationResult | null>(null)
const ruleLoading = ref(false)
const ruleError = ref('')
let ruleTimer = 0
let ruleSeq = 0
const runRule = async () => {
  const mine = ++ruleSeq
  ruleLoading.value = true
  ruleError.value = ''
  try {
    const r = await queryPenetration(props.target)
    if (mine !== ruleSeq) return
    rule.value = r
    emit('matched', r.matched ? r.matched.index : null)
  } catch (err) {
    if (mine !== ruleSeq) return
    rule.value = null
    emit('matched', null)
    ruleError.value = t('penetrationQueryFailed', { message: err instanceof Error ? err.message : String(err) })
  } finally {
    if (mine === ruleSeq) ruleLoading.value = false
  }
}
// 边输入边查,停 400ms 再发请求(规则集匹配要起一次内核进程,不能每个字母都跑)
watch(
  () => props.target,
  () => {
    window.clearTimeout(ruleTimer)
    ruleTimer = window.setTimeout(runRule, 400)
  },
  { immediate: true },
)

// ---------- 真实路由:模拟终端(默认)/ 内核诊断 ----------
type ActualMode = 'terminal' | 'kernel'
const mode = ref<ActualMode>('terminal')
const capability = ref<OpenboxTerminalCapability | null>(null)
const terminal = ref<OpenboxTerminalTest | null>(null)
const actual = ref<OpenboxRouteTest | null>(null)
const actualLoading = ref(false)
const actualError = ref('')
let actualTimer = 0
let actualSeq = 0
const loadCapability = async () => {
  if (!capabilityPromise) {
    capabilityPromise = fetchTerminalCapability().catch((err) => {
      capabilityPromise = null
      throw err
    })
  }
  const cap = await capabilityPromise
  capability.value = cap
  return cap
}
const runActual = async () => {
  const mine = ++actualSeq
  actualLoading.value = true
  actualError.value = ''
  try {
    if (mode.value === 'terminal') {
      const cap = await loadCapability()
      if (mine !== actualSeq) return
      // 不具备条件:停在这里如实提示,不悄悄改跑内核诊断
      if (!cap.ok) { terminal.value = null; return }
      const r = await testTerminal(props.target, props.port ?? undefined)
      if (mine !== actualSeq) return
      terminal.value = r
    } else {
      const r = await testRoute(props.target, props.port ?? undefined)
      if (mine !== actualSeq) return
      actual.value = r
    }
  } catch (err) {
    if (mine !== actualSeq) return
    actual.value = null
    terminal.value = null
    actualError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (mine === actualSeq) actualLoading.value = false
  }
}
const switchMode = (m: ActualMode) => {
  if (mode.value === m) return
  mode.value = m
  actual.value = null
  terminal.value = null
  actualError.value = ''
  window.clearTimeout(actualTimer)
  void runActual()
}
// 真实访问一次是有代价的(出网、占一条连接),等输入停下 600ms 再跑
watch(
  () => [props.target, props.port] as const,
  () => {
    window.clearTimeout(actualTimer)
    actual.value = null
    terminal.value = null
    actualTimer = window.setTimeout(runActual, 600)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  window.clearTimeout(ruleTimer)
  window.clearTimeout(actualTimer)
})

// ---------- 通用 ----------
type Tone = RouteStageTone
// ② 这一站的显示模型:左右两列共用一个形状,没有的字段就空着(模板里不做联合类型收窄)
interface DnsView {
  kind: 'none' | 'skip' | 'error' | 'reject' | 'decision'
  state: RouteStageState
  badge?: string
  tone: Tone
  message?: string
  viaProxy?: boolean
  // lan:模拟终端问的是 LAN 的 DNS(不是内核的解析器)
  lan?: boolean
  serverLine?: string
  tag?: string
  detour?: string
  // 命中的 DNS 重写:「原域名 → 目标」
  rewrite?: string
  v4?: { text: string; tone: Tone }
  // queried:档案开了 IPv6、这次真的查了 AAAA;没查的(未开启 IPv6)不占主行,进详情
  v6?: { text: string; tone: Tone; queried: boolean }
  notes?: Array<{ text: string; warn?: boolean }>
  chain?: string[]
  // 模拟终端:主行标签按内核实际用的解析器写(代理 DNS / 直连 DNS / FakeIP …),截不到内核过程时才是 LAN DNS
  label?: string
  // 模拟终端:内核侧的解析流程一句(从内核日志截的):节点(X) → TCP 1.1.1.1 / 10.0.0.1 → UDP 上游
  kernelLine?: string
  kernelWarn?: boolean
  answers?: string[]
  answers6?: string[]
  stale?: string
  // 没给来源时按"不在该来源"跳过的 DNS 规则:assumptions 是会改变解析器的(提示),assumptionsSame 是结果一样的(一句带过)
  assumptions?: string[]
  assumptionsSame?: string[]
}
interface DetailLine { text: string; mono?: boolean; warn?: boolean; label?: string }
const toneClass = (tone: Tone | undefined) => {
  switch (tone) {
    case 'good': return 'badge-success badge-soft'
    case 'proxy': return 'badge-info badge-soft'
    // 待确认用实底(黄底深字):badge-soft 的黄字在浅色主题上看不清
    case 'pending': return 'badge-warning'
    case 'error': return 'badge-error badge-soft'
    default: return 'badge-ghost'
  }
}
const typeLabel = (type: string) => t(ruleTypeLabelKey(type))
// 查询目标是域名 / IPv4 / IPv6:决定 ① 的标签和 ②「无需 DNS」的措辞
const targetKind = computed<'domain' | 'ipv4' | 'ipv6'>(() => {
  const v = props.target
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'ipv4'
  if (v.includes(':')) return 'ipv6'
  return 'domain'
})
const kindText = computed(() => t(targetKind.value === 'domain' ? 'routeKindDomain' : targetKind.value === 'ipv4' ? 'routeKindIpv4' : 'routeKindIpv6'))
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)])
// 命中 DNS 重写时的一句:「DNS 重写:services.googleapis.cn → services.googleapis.com」
const rewriteLineOf = (r?: { source: string; domain: string; addresses: string[] }) => {
  if (!r || !r.source) return ''
  return t('routeDnsRewriteHit', { source: r.source, target: r.domain || r.addresses.join(', ') })
}
const serverLineOf = (s?: { tag: string; type?: string; server?: string }) => {
  if (!s) return ''
  const type = s.type === 'local' ? 'local' : s.type || ''
  return [type && s.server ? `${type.toUpperCase()} ${s.server}` : type || s.server].filter(Boolean).join(' ')
}
// HTTP 状态码翻译成人话:2xx 正常;3xx 跳转;4xx 站点能到但拒了请求;5xx 站点能到但它自己出错
const statusText = (code: number) => {
  const exact = t(`httpStatus_${code}`)
  if (exact !== `httpStatus_${code}`) return exact
  const family = `httpStatus_${Math.floor(code / 100)}xx`
  const text = t(family)
  return text === family ? '' : text
}
const statusTone = (code: number): Tone => (code < 400 ? 'good' : 'pending')
// 访问失败的原因翻译成人话
const errorText = (raw: string) => {
  if (/^dns: /i.test(raw)) return t('routeTermDnsFailed', { message: raw.replace(/^dns:\s*/i, '') })
  if (/timeout/i.test(raw)) return t('routeTestErrTimeout')
  if (/^inbound:/i.test(raw)) return t('routeTestErrInbound')
  if (/^CONNECT:/i.test(raw)) return t('routeTestErrConnect', { detail: raw.replace(/^CONNECT:\s*/i, '') })
  if (/connection closed|ECONNRESET/i.test(raw)) return t('routeTestErrClosed')
  if (/ECONNREFUSED/i.test(raw)) return t('routeTestErrRefused')
  return raw
}

// ---------- 左列:规则路由 ----------
const ruleOutbound = computed(() => rule.value?.finalOutbound || '')
const ruleOwner = computed(() => rule.value?.matched?.ownerName || '')
// 具体命中的第一条条目(规则集解码出来的,或站点集里手写的),跟在站点集名后面显示
const firstEntry = computed(() => rule.value?.matched?.entries?.[0] || null)
const ruleReject = computed(() => rule.value?.matched?.action === 'reject')
// 推算里按"不满足它"跳过的规则,写成一行人话:第 N 条只在<条件>时生效(<去向>);查询没给<信息>,按不满足它的情况推算
const needWord = (n: string) => t(n === 'sourceIp' ? 'routeNeedSourceIp' : n === 'port' ? 'routeNeedPort' : 'routeNeedIpVersion')
// 单个地址的 /32、/128 不显示,多个用顿号连
const hostList = (list: string[]) => list.map((c) => c.replace(/\/(32|128)$/, '')).join(t('routeListJoin'))
const assumptionLine = (a: OpenboxRuleAssumption) => {
  const r = a.rule
  const scope = a.needs.map((n) => {
    if (n === 'sourceIp') return t('routeAssumeSource', { cidrs: hostList(listOf(r.source_ip_cidr)) })
    if (n === 'port') return t('routeAssumePort', { ports: [...listOf(r.port), ...listOf(r.port_range)].join(t('routeListJoin')) })
    return t('routeAssumeIpVersion', { v: String(r.ip_version ?? '') })
  }).join(t('routeNeedJoin'))
  const outcome = a.action === 'reject' ? t('routeAssumeReject') : a.outbound ? t('routeAssumeOutbound', { outbound: a.outbound }) : a.action || ''
  const needs = a.needs.map(needWord).join(t('routeNeedJoin'))
  return a.sameOutcome ? t('routeRuleAssumedSame', { index: a.index + 1, scope, outcome }) : t('routeRuleAssumed', { index: a.index + 1, scope, outcome, needs })
}
// 会改变出口的前提(relevant)才影响这次推算的结论;去向和结果一样的(same)只在详情里一句带过
const ruleAssumptions = computed(() => {
  const list = rule.value?.assumed || []
  return { relevant: list.filter((a) => !a.sameOutcome).map(assumptionLine), same: list.filter((a) => a.sameOutcome).map(assumptionLine) }
})
const dnsAssumptionLines = (list?: OpenboxDnsAssumption[]) => {
  const line = (a: OpenboxDnsAssumption) => {
    const outcome = a.action === 'reject' ? t('routeAssumeReject') : a.server ? t('routeAssumeDnsServer', { server: a.server }) : ''
    const cidrs = hostList(a.sourceIpCidr || [])
    return a.sameOutcome ? t('routeDnsAssumedSame', { index: a.ruleIndex + 1, cidrs, outcome }) : t('routeDnsAssumed', { index: a.ruleIndex + 1, cidrs, outcome })
  }
  return { relevant: (list || []).filter((a) => !a.sameOutcome).map(line), same: (list || []).filter((a) => a.sameOutcome).map(line) }
}
const conditionText = computed(() => {
  const r = (rule.value?.matched?.rule || {}) as Record<string, unknown>
  if (r.ip_is_private) return t('penetrationRulePrivateIp')
  return Object.entries(r)
    .filter(([k]) => !['outbound', 'action'].includes(k))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(' ') : String(v)}`)
    .join('  ')
})
const rulePill = computed<{ text: string; tone: Tone }>(() => {
  if (ruleError.value) return { text: t('routeCmpPillFailed'), tone: 'error' }
  if (!rule.value) return { text: '…', tone: 'muted' }
  if (rule.value.matchError) return { text: t('routeCmpPillUnknown'), tone: 'pending' }
  if (ruleAssumptions.value.relevant.length) return { text: t('routeCmpPillAssumed'), tone: 'pending' }
  return { text: t('routeCmpPillPredicted'), tone: 'good' }
})
const ruleDns = computed<DnsView>(() => {
  const d = rule.value?.dns
  if (!rule.value || ruleError.value) return { kind: 'none', state: 'ok', tone: 'muted' }
  if (!d || 'skipped' in d) return { kind: 'skip', state: 'skip', badge: t('routeDnsSkippedBadge'), tone: 'muted' }
  if ('error' in d) return { kind: 'error', state: 'pending', badge: t('routeDnsUnknown'), tone: 'pending', message: d.error }
  if (d.rejected) return { kind: 'reject', state: 'ok', badge: t('routeDnsPredicted'), tone: 'muted' }
  return {
    kind: 'decision', state: 'ok', badge: t('routeDnsPredicted'), tone: 'muted',
    viaProxy: Boolean(d.viaProxy), serverLine: serverLineOf(d.server) || d.server?.tag || '', tag: d.server?.tag || '', detour: d.server?.detour || '',
    rewrite: rewriteLineOf(d.rewrite),
    assumptions: dnsAssumptionLines(d.assumed).relevant, assumptionsSame: dnsAssumptionLines(d.assumed).same,
  }
})
// ③ 左:入口是配置状态,不是本目标的观测——只有目标是 IP、且命中的规则集正好在旁路集合里,才能说它会在入口旁路
const ruleEntry = computed(() => {
  const f = rule.value?.firstLayer
  if (!rule.value || ruleError.value) return { state: 'ok' as RouteStageState, value: '', sub: '', detail: '' }
  if (!f) return { state: 'pending' as RouteStageState, value: t('routeEntryUnknown'), sub: t('routeEntryNoMeta'), detail: '' }
  if (!f.nativeBypass?.enabled) {
    return { state: 'ok' as RouteStageState, value: t('routeEntryKernel'), sub: t('routeEntryNoBypass'), detail: t('ruleLookupFirstLayerBypassOff', { reason: f.nativeBypass?.reason || '' }) }
  }
  const sets = f.nativeBypass.sets
  const hit = targetKind.value === 'domain' ? '' : listOf((rule.value.matched?.rule as Record<string, unknown> | undefined)?.rule_set).find((s) => sets.includes(s)) || ''
  if (hit) return { state: 'ok' as RouteStageState, value: t('routeEntryBypassHit', { set: hit }), sub: t('routeEntryBypassConfigured', { sets: sets.join(', ') }), detail: t('ruleLookupFirstLayerBypassOn', { sets: sets.join(', '), via: f.nativeBypass.via === 'route' ? t('ruleLookupFirstLayerViaRoute') : 'nft' }) }
  return { state: 'pending' as RouteStageState, value: t('routeEntryBypassUndetermined'), sub: t('routeEntryBypassConfigured', { sets: sets.join(', ') }), detail: t('routeEntryBypassUndeterminedDetail') }
})
const ruleMatch = computed<{ state: RouteStageState; badge?: string; tone: Tone }>(() => {
  const r = rule.value
  if (!r || ruleError.value) return { state: 'ok', tone: 'muted' }
  if (r.matchError) return { state: 'pending', badge: t('penetrationRuleUnknown'), tone: 'pending' }
  if (r.matched) return { state: 'ok', badge: t('routeRuleMatchedBadge', { index: r.matched.index + 1 }), tone: r.matched.action === 'reject' ? 'error' : 'good' }
  return { state: 'ok', badge: t('routeRuleFallbackBadge'), tone: 'muted' }
})
const ruleExit = computed<{ state: RouteStageState; badge?: string; tone: Tone }>(() => {
  const r = rule.value
  if (!r || ruleError.value) return { state: 'ok', tone: 'muted' }
  if (r.matchError) return { state: 'pending', badge: t('routeExitStatusPending'), tone: 'pending' }
  if (ruleReject.value) return { state: 'ok', badge: t('routeExitBlocked'), tone: 'error' }
  const out = r.finalOutbound || ''
  const leaf = r.chain?.length ? r.chain[r.chain.length - 1] : out
  const isDirect = Boolean(leaf) && proxyMap.value[leaf]?.type?.toLowerCase() === 'direct'
  return { state: 'ok', badge: t(isDirect ? 'routeExitDirect' : 'routeExitProxy'), tone: isDirect ? 'good' : 'proxy' }
})

// ---------- 右列:两种测法共用的骨架 ----------
// 模拟终端的有效结果:具备条件、虚拟终端建起来了、真的发了一次访问
const termResult = computed(() => {
  const tr = terminal.value
  return tr && tr.capable && !tr.setupError && tr.exit ? tr : null
})
// 模拟终端跑不了的原因:设备不具备条件(列出缺什么)/ 虚拟终端没建起来(原因原文)
const termBlock = computed<{ kind: 'incapable'; missing: OpenboxTerminalMissing[] } | { kind: 'setup'; message: string } | null>(() => {
  if (mode.value !== 'terminal') return null
  if (capability.value && !capability.value.ok) return { kind: 'incapable', missing: capability.value.missing }
  const tr = terminal.value
  if (tr && !tr.capable) return { kind: 'incapable', missing: tr.missing || [] }
  if (tr && tr.setupError) return { kind: 'setup', message: tr.setupError }
  return null
})
const missingText = computed(() => {
  const b = termBlock.value
  const list = b && b.kind === 'incapable' ? b.missing : []
  return list.map((m) => t(`routeTermMissing_${m}`)).join(t('routeListJoin'))
})
const hasResult = computed(() => (mode.value === 'terminal' ? Boolean(termResult.value) : Boolean(actual.value)))
const placeholderText = computed(() => (actualError.value ? '—' : actualLoading.value ? t('routeExitStatusTesting') : termBlock.value ? '—' : t('routeCmpWaiting')))
const actualPill = computed<{ text: string; tone: Tone }>(() => {
  if (actualError.value) return { text: t('routeCmpPillFailed'), tone: 'error' }
  const b = termBlock.value
  if (b) return b.kind === 'incapable' ? { text: t('routeTermPillIncapable'), tone: 'pending' } : { text: t('routeTermPillSetupFailed'), tone: 'error' }
  const e = mode.value === 'terminal' ? termResult.value?.exit : actual.value?.exit
  if (!e) return { text: t('routeExitStatusTesting'), tone: 'muted' }
  if (e.error) return { text: t('routeExitStatusFailed'), tone: 'error' }
  if (e.status !== undefined && e.status < 300) return { text: t('routeExitStatusSuccess'), tone: 'good' }
  if (e.status !== undefined && e.status < 400) return { text: t('routeExitStatusReachable'), tone: 'good' }
  if (e.status !== undefined) return { text: t('routeExitStatusReachable'), tone: 'pending' }
  return { text: t('routeExitStatusPending'), tone: 'pending' }
})

// ---------- 右列:内核诊断(回环 mixed 入站) ----------
const dnsSkipped = computed(() => Boolean(actual.value && actual.value.dns && 'skipped' in actual.value.dns))
const actualDecision = computed(() => {
  const d = actual.value?.dns
  return d && 'ruleIndex' in d ? d : null
})
const actualExitIp = computed(() => actual.value?.exit.destinationIP || actual.value?.exit.connectTo || '')
// 本地这次解析的答案是线路对端的 fake-ip:应答者就是 detour 此刻落到的那个节点
const fakeIpHop = computed(() => (actual.value?.resolve?.fakeIp && !actual.value.resolve.fakeIpLocal && actual.value.resolve.fakeIpFrom) || '')
const kernelDns = computed<DnsView>(() => {
  const a = actual.value
  if (!a || actualError.value) return { kind: 'none', state: 'ok', tone: 'muted' }
  const d = a.dns
  if (!d || 'skipped' in d) return { kind: 'skip', state: 'skip', badge: t('routeDnsSkippedBadge'), tone: 'muted' }
  if ('error' in d) return { kind: 'error', state: 'pending', badge: t('routeDnsUnknown'), tone: 'pending', message: d.error }
  if (d.rejected) return { kind: 'reject', state: 'ok', badge: t('routeDnsMeasured'), tone: 'muted' }
  const r = a.resolve
  const answers = r?.answers || []
  const answers6 = r?.answers6 || []
  const v4 = answers.length
    ? { text: t('routeDnsV4Ok', { count: answers.length }), tone: 'good' as Tone }
    : r?.error ? { text: t('routeDnsV4Failed', { message: r.error }), tone: 'pending' as Tone } : { text: t('routeDnsV4Empty'), tone: 'pending' as Tone }
  const v6 = !r || r.answers6 === undefined
    ? { text: t('routeDnsV6NotQueried'), tone: 'muted' as Tone, queried: false }
    : answers6.length ? { text: t('routeDnsV6Ok', { count: answers6.length }), tone: 'good' as Tone, queried: true }
      : r.error6 ? { text: t('routeDnsV6Failed', { message: r.error6 }), tone: 'muted' as Tone, queried: true } : { text: t('routeDnsV6Empty'), tone: 'muted' as Tone, queried: true }
  const notes: Array<{ text: string; warn?: boolean }> = []
  const serverAddr = d.server?.server || d.server?.tag || ''
  if (fakeIpHop.value) {
    notes.push({ text: `${fakeIpHop.value}:${t('routeTestFakeIpAnswered')}`, warn: true })
    notes.push({ text: t('routeTestFakeIpIntercepted', { server: serverAddr }) })
  } else if (r?.cached) notes.push({ text: t('routeTestDnsCached', { ttl: r.ttl ?? '?' }), warn: true })
  else if (answers.length) notes.push({ text: t('routeTestAnsweredBy', { server: serverAddr }) })
  if (r?.fakeIpLocal) notes.push({ text: t('routeTestFakeIpLocal') })
  else if (r?.fakeIp && !fakeIpHop.value) notes.push({ text: t('routeTestFakeIpUpstream'), warn: true })
  const chain = d.server?.detour ? (d.runtimeChain?.length ? d.runtimeChain : [d.server.detour]) : []
  const failed = !answers.length && !answers6.length
  return {
    kind: 'decision',
    state: failed ? 'pending' : 'ok',
    badge: r ? `${r.ms} ms` : t('routeDnsMeasured'),
    tone: failed ? 'pending' : 'good',
    viaProxy: Boolean(d.viaProxy), serverLine: serverLineOf(d.server) || d.server?.tag || '', tag: d.server?.tag || '',
    rewrite: rewriteLineOf(d.rewrite),
    v4, v6, notes, chain, answers, answers6,
    stale: d.stale ? t(d.stale === 'direct' ? 'routeTestDnsStaleDirect' : 'routeTestDnsStaleProxy') : '',
    assumptions: dnsAssumptionLines(d.assumed).relevant, assumptionsSame: dnsAssumptionLines(d.assumed).same,
  }
})
// ③ 右(内核诊断):只有连接表里认出了这条连接,才能说"经过了内核"
const kernelEntry = computed(() => {
  const e = actual.value?.exit
  if (!e || actualError.value) return { state: 'ok' as RouteStageState, value: '', sub: '', badge: undefined as string | undefined, tone: 'muted' as Tone }
  if (e.chains?.length || e.rule || e.destinationIP) return { state: 'ok' as RouteStageState, value: t('routeEntryPanelInbound'), sub: t('routeEntryPanelKernel'), badge: t('routeEntryEntered'), tone: 'good' as Tone }
  if (e.error && /^inbound:/i.test(e.error)) return { state: 'pending' as RouteStageState, value: t('routeEntryUnknown'), sub: t('routeTestErrInbound'), badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
  if (e.notSeen) return { state: 'pending' as RouteStageState, value: t('routeEntryPanelNotSeen'), sub: t(e.error ? 'routeTestNotSeenFailed' : 'routeTestNotSeen'), badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
  return { state: 'pending' as RouteStageState, value: t('routeEntryUnknown'), sub: e.connectionsError || '', badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
})
// 走节点、拿到的是真实 IP:节点按它直接连。这个地址是不是节点位置就近的 CDN,看那次解析是经节点问的还是直连问的
const exitNodeNote = computed(() => {
  const e = actual.value?.exit
  if (!e?.viaProxy || fakeIpHop.value) return null
  const ip = e.destinationIP || e.connectTo
  if (!ip) return null
  const viaProxyDns = Boolean(actualDecision.value?.viaProxy)
  if (actual.value?.resolve?.cached) return { text: t('routeTestExitByIpCached', { ip }), warn: true }
  return { text: t(viaProxyDns ? 'routeTestExitByIp' : 'routeTestExitByIpDirectDns', { ip }), warn: !viaProxyDns }
})

// ---------- 右列:模拟终端 ----------
// ② 模拟终端的 DNS:问的是 LAN 的 DNS(DHCP 发下来的那台,一般就是路由器的 dnsmasq);
//    详情里说这条查询是谁应答的(conntrack 证据)以及 dnsmasq 按转发清单会把它交给谁(配置推算)
const termDns = computed<DnsView>(() => {
  const tr = termResult.value
  if (!tr) return { kind: 'none', state: 'ok', tone: 'muted' }
  const d = tr.dns
  if (!d || 'skipped' in d) return { kind: 'skip', state: 'skip', badge: t('routeDnsSkippedBadge'), tone: 'muted' }
  const answers = d.answers || []
  const answers6 = d.answers6 || []
  const v4 = answers.length
    ? { text: t('routeDnsV4Ok', { count: answers.length }), tone: 'good' as Tone }
    : d.error ? { text: t('routeDnsV4Failed', { message: d.error }), tone: 'pending' as Tone } : { text: t('routeDnsV4Empty'), tone: 'pending' as Tone }
  const v6 = d.answers6 === undefined
    ? { text: t('routeDnsV6NotQueried'), tone: 'muted' as Tone, queried: false }
    : answers6.length ? { text: t('routeDnsV6Ok', { count: answers6.length }), tone: 'good' as Tone, queried: true }
      : d.error6 ? { text: t('routeDnsV6Failed', { message: d.error6 }), tone: 'muted' as Tone, queried: true } : { text: t('routeDnsV6Empty'), tone: 'muted' as Tone, queried: true }
  const notes: Array<{ text: string; warn?: boolean }> = []
  const ev = tr.dnsEvidence
  if (ev) {
    if (ev.hijacked) notes.push({ text: t('routeTermDnsHijacked', { server: ev.answeredBy }), warn: true })
    else if (ev.flows) notes.push({ text: t('routeTermDnsAnsweredBy', { server: ev.answeredBy }) })
    else notes.push({ text: t('routeTermDnsNoFlow'), warn: true })
  }
  const f = tr.dnsForward
  if (f) {
    if (f.plan === 'all') notes.push({ text: t('routeTermDnsForwardAll') })
    else if (f.forward === 'kernel') notes.push({ text: t('routeTermDnsForwardKernel', { suffix: f.suffix || '', to: f.to || '' }) })
    else if (f.forward === 'upstream') notes.push({ text: t('routeTermDnsForwardUpstream') })
  }
  // 下一层:进内核之后的实际处理(内核日志实录)。主行标签和地址按内核实际用的解析器写,第二行一句流程:
  // 节点(自建 | 美国-TUD-01) → TCP 1.1.1.1 / 10.0.0.1 → UDP 211.139.29.150。没截到就说清楚为什么看不到,不推算
  const k = tr.kernelDns
  let kernelLine = ''
  let kernelWarn = false
  let tag = ''
  let chain: string[] = []
  let label = ''
  let serverLine = `UDP ${d.server}`
  if (k && k.seen) {
    tag = k.server?.tag || ''
    chain = k.viaProxy ? (k.chain.length ? k.chain : [k.server?.detour || '']).filter(Boolean) : []
    const server = k.server && k.server.server ? `${(k.server.type || '').toUpperCase()} ${k.server.server}${k.server.port ? `:${k.server.port}` : ''}`.trim() : tag
    // 内核自己的 FakeIP:域名不在这边解析,连接进内核后把域名交给出站节点(连接记录里的叶子),由节点那边的 DNS 解析
    const exitNode = tr.kernel?.chains?.length ? tr.kernel.chains[tr.kernel.chains.length - 1] : ''
    if (k.result === 'action') { label = t('routeTermKdnsLabelAction'); serverLine = ''; kernelLine = t('routeTermKdnsFlowAction', { action: k.action }) }
    else if (k.fakeIpLocal) { label = t('routeTermKdnsLabelFakeIp'); serverLine = t('routeTermKdnsFakeIpServer'); kernelLine = exitNode ? t('routeTermKdnsFlowFakeIpLocal', { node: exitNode }) : t('routeTermKdnsFlowFakeIpLocalNoNode', { ip: k.answers[0] || '' }) }
    else if (k.fakeIp && k.viaProxy) { label = t('routeTestDnsProxy'); serverLine = server; kernelLine = t('routeTermKdnsFlowProxy', { node: k.outbound || chain[chain.length - 1] || '', server }); kernelWarn = true }
    else if (k.rewrite) { label = t('routeDnsRewrite'); serverLine = server; kernelLine = t('routeTermKdnsFlowRewrite', { server }) }
    else if (k.viaProxy) { label = t('routeTestDnsProxy'); serverLine = server; kernelLine = k.outbound ? t('routeTermKdnsFlowProxy', { node: k.outbound, server }) : t('routeTermKdnsFlowProxyGroup', { detour: k.server?.detour || '', server }) }
    else { label = t('routeTestDnsDirect'); serverLine = server; kernelLine = t('routeTermKdnsFlowDirect', { lan: d.server, server }) }
    notes.push({ text: k.ruleIndex === null ? t('routeTermKdnsFinal') : t('routeTermKdnsRule', { index: k.ruleIndex + 1, cond: k.ruleText }) })
    if (k.fakeIpLocal) notes.push({ text: t('routeTermKdnsFakeIpNote', { ip: k.answers[0] || '', node: exitNode || '?' }) })
    else if (k.fakeIp && k.viaProxy) notes.push({ text: `${k.outbound || chain[chain.length - 1] || ''}:${t('routeTestFakeIpAnswered')}`, warn: true })
    else if (k.result === 'exchanged') notes.push({ text: t('routeTermKdnsExchanged', { rcode: k.rcode, ttl: k.ttl ?? '?', ms: k.ms ?? '?' }) })
    else if (k.result === 'cached') notes.push({ text: t('routeTermKdnsCached', { ttl: k.ttl ?? '?' }), warn: true })
    else if (k.result === 'optimistic') notes.push({ text: t('routeTermKdnsOptimistic'), warn: true })
    else if (k.result === 'failed') notes.push({ text: t('routeTermKdnsFailed', { message: k.error }), warn: true })
    else if (k.result === 'pending') notes.push({ text: t('routeTermKdnsPending'), warn: true })
    if (k.fakeIp && !k.viaProxy && !k.fakeIpLocal) notes.push({ text: t('routeTestFakeIpUpstream'), warn: true })
    if (k.v6) {
      if (k.v6.result === 'rejected') notes.push({ text: t('routeTermKdnsV6Rejected') })
      else if (k.v6.result === 'failed') notes.push({ text: t('routeTermKdnsFailed', { message: k.v6.error }), warn: true })
      else if (k.v6.answers.length) notes.push({ text: t('routeTermKdnsV6Ok', { count: k.v6.answers.length }) })
    }
  } else if (k) {
    if (k.reason === 'no-log') notes.push({ text: t('routeTermKdnsNoLog', { error: k.error || '' }), warn: true })
    else if (f && f.forward === 'upstream') notes.push({ text: t('routeTermKdnsNotEntered') })
    else notes.push({ text: t('routeTermKdnsNotSeen'), warn: true })
  }
  const failed = !answers.length && !answers6.length
  return {
    kind: 'decision',
    state: failed ? 'pending' : 'ok',
    badge: `${d.ms} ms`,
    tone: failed ? 'pending' : 'good',
    lan: true, label, serverLine, tag,
    v4, v6, notes, chain, kernelLine, kernelWarn, answers, answers6,
  }
})
// ③ 模拟终端的入口:按系统证据判(见 server/system/lan-probe.mjs 的 classifyEntry)
const reasonKey: Record<string, string> = {
  'no-conntrack': 'routeTermReasonNoConntrack',
  'dnat-elsewhere': 'routeTermReasonDnatElsewhere',
  'no-route': 'routeTermReasonNoRoute',
  'route-tun': 'routeTermReasonRouteTun',
  'not-connected': 'routeTermReasonNotConnected',
  'no-connection': 'routeTermReasonNoConnection',
  'evidence-failed': 'routeTermReasonEvidenceFailed',
}
const reasonText = (e: OpenboxTerminalEntry) => {
  const key = reasonKey[e.reason || '']
  return key ? t(key, { to: e.rewrittenTo || '', error: e.error || '' }) : e.reason || ''
}
const termEntry = computed(() => {
  const tr = termResult.value
  const e = tr?.entry
  if (!tr || !e) return { state: 'ok' as RouteStageState, value: '', sub: '', badge: undefined as string | undefined, tone: 'muted' as Tone }
  if (e.kind === 'bypass') return { state: 'ok' as RouteStageState, value: t('routeTermEntryBypass'), sub: t('routeTermEntryBypassSub', { device: e.device || '' }), badge: t('routeTermBypassed'), tone: 'good' as Tone }
  if (e.kind === 'kernel') {
    const sub = e.via === 'redirect'
      ? t('routeTermEntryRedirectSub', { port: e.redirectPort ?? '' })
      : e.via === 'tun' ? t('routeTermEntryTunSub', { device: e.evidence.tunDevice || 'tun' }) : t('routeTermEntrySeenSub')
    return { state: 'ok' as RouteStageState, value: t('routeEntryKernel'), sub, badge: t('routeEntryEntered'), tone: 'good' as Tone }
  }
  return { state: 'pending' as RouteStageState, value: t('routeTermEntryUnknown'), sub: reasonText(e), badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
})
const entryEvidence = computed<DetailLine[]>(() => {
  const tr = termResult.value
  const e = tr?.entry
  if (!tr || !e) return []
  const ev = e.evidence || {}
  const out: DetailLine[] = []
  if (ev.autoRedirect !== undefined) out.push({ text: t(ev.autoRedirect ? 'routeTermEvAutoRedirect' : 'routeTermEvTunOnly') })
  if (ev.conntrack) out.push({ label: 'conntrack', text: ev.conntrack, mono: true })
  else out.push({ text: t('routeTermReasonNoConntrack'), warn: true })
  if (ev.route) out.push({ label: t('routeTermEvRoute'), text: ev.route, mono: true })
  if (e.kind === 'bypass') out.push({ text: e.masquerade ? t('routeTermEvMasq', { device: e.device || '', address: tr.exit?.forward?.address || '' }) : t('routeTermEvNoMasq') })
  const ip = tr.exit?.connectTo || ''
  if (ev.set) out.push({ text: t(ev.setHit ? 'routeTermEvSetHit' : 'routeTermEvSetMiss', { ip, set: ev.set }), warn: e.kind === 'bypass' && !ev.setHit })
  else out.push({ text: t('routeTermEvNoSet') })
  out.push({ text: ev.kernelConn ? t('routeTermEvKernelSeen', { inbound: tr.kernel?.inbound || '' }) : t('routeTermEvKernelNone') })
  if (ev.kernelError) out.push({ text: ev.kernelError, warn: true })
  if (e.kind === 'unknown') out.push({ text: reasonText(e), warn: true })
  return out
})

// ---------- 右列:按当前测法选一份 ----------
const actualDns = computed<DnsView>(() => (mode.value === 'terminal' ? termDns.value : kernelDns.value))
const actualEntry = computed(() => (mode.value === 'terminal' ? termEntry.value : kernelEntry.value))
// ④:旁路命中 → 跳过;进了内核 → 连接表里的归属和规则原文;进了内核却没找到 → 说明
const ruleView = computed(() => {
  if (mode.value === 'terminal') {
    const tr = termResult.value
    const e = tr?.entry
    if (!tr || !e) return { skipped: false, notSeen: false, owner: '', rule: '' }
    if (e.kind === 'bypass') return { skipped: true, notSeen: false, owner: '', rule: '' }
    const k = tr.kernel
    if (e.kind === 'kernel' && !k?.seen) return { skipped: false, notSeen: true, owner: '', rule: '' }
    return { skipped: false, notSeen: false, owner: k?.chains?.[0] || '', rule: k?.rule || '' }
  }
  const e = actual.value?.exit
  return { skipped: false, notSeen: false, owner: e?.chains?.[0] || '', rule: e?.rule || '' }
})
const actualRule = computed<{ state: RouteStageState; badge?: string; tone: Tone }>(() => {
  if (!hasResult.value || actualError.value) return { state: 'ok', tone: 'muted' }
  const v = ruleView.value
  if (v.skipped) return { state: 'skip', badge: t('routeTermRuleSkipped'), tone: 'muted' }
  if (v.notSeen) return { state: 'pending', badge: t('routeEntryUnknown'), tone: 'pending' }
  if (v.rule || v.owner) return { state: 'ok', badge: t('routeRuleRecord'), tone: 'muted' }
  return { state: 'pending', badge: t('routeEntryUnknown'), tone: 'pending' }
})
// ⑤:旁路 → "系统转发,经 WAN 设备直接出去";进内核 → 内核记录的链路;都带 HTTP 结果
const exitView = computed(() => {
  if (mode.value === 'terminal') {
    const tr = termResult.value
    const x = tr?.exit
    if (!tr || !x) return { chains: [] as string[], status: undefined as number | undefined, error: '', ms: undefined as number | undefined, forward: null as { device: string; gateway: string } | null }
    const forward = tr.entry?.kind === 'bypass' ? { device: x.forward?.device || tr.entry.device || '', gateway: x.forward?.gateway || tr.entry.gateway || '' } : null
    return { chains: tr.kernel?.chains || [], status: x.status, error: x.error || '', ms: x.ms, forward }
  }
  const e = actual.value?.exit
  return { chains: e?.chains || [], status: e?.status, error: e?.error || '', ms: e?.ms, forward: null }
})
const actualExit = computed<{ state: RouteStageState; badge?: string; tone: Tone }>(() => {
  if (!hasResult.value || actualError.value) return { state: 'ok', tone: 'muted' }
  const v = exitView.value
  const badge = v.ms !== undefined ? `${v.ms} ms` : undefined
  if (v.error) return { state: 'pending', badge, tone: 'error' }
  if (v.status !== undefined && v.status >= 400) return { state: 'ok', badge, tone: 'pending' }
  return { state: 'ok', badge, tone: 'good' }
})
const exitDetails = computed<DetailLine[]>(() => {
  const out: DetailLine[] = []
  if (mode.value === 'terminal') {
    const tr = termResult.value
    const x = tr?.exit
    if (!tr || !x) return out
    if (x.connectTo) out.push({ text: t('routeExitTarget', { ip: x.connectTo }), mono: true })
    if (tr.source && x.localPort) out.push({ text: t('routeTermExitLocalPort', { ip: tr.source.ip, port: x.localPort }), mono: true })
    if (x.forward) out.push({ text: t('routeTermExitForwardAddress', { device: x.forward.device, address: x.forward.address || '—' }), mono: true })
    if (tr.kernel?.seen && tr.kernel.viaProxy && x.connectTo) out.push({ text: t('routeTestExitByIpDirectDns', { ip: x.connectTo }), warn: true })
    return out
  }
  const a = actual.value
  if (!a) return out
  if (actualExitIp.value) out.push({ text: t('routeExitTarget', { ip: actualExitIp.value }), mono: true })
  if (a.exit6) out.push({ text: `IPv6 ${a.exit6.connectTo}: ${a.exit6.ok ? `HTTP ${a.exit6.status} · ${a.exit6.ms}ms` : t('routeTestRequestFailed', { message: errorText(a.exit6.error || '') })}`, warn: !a.exit6.ok })
  if (exitNodeNote.value) out.push({ text: exitNodeNote.value.text, warn: exitNodeNote.value.warn })
  return out
})
</script>

<style scoped>
.route-cell {
  order: var(--m-order);
  border-color: color-mix(in srgb, var(--color-base-300) 60%, transparent);
}
/* 需要留意的长句:不用黄字(浅色主题上看不清),用淡黄底 + 左侧色条,正文仍是正常文字色 */
.route-note {
  display: block;
  border-left: 2px solid var(--color-warning);
  background-color: color-mix(in srgb, var(--color-warning) 12%, transparent);
  border-radius: 0 0.375rem 0.375rem 0;
  padding: 0.125rem 0.5rem;
  color: color-mix(in srgb, var(--color-base-content) 85%, transparent);
}
/* 列头图标:和各站的圆圈同一列(left 0.9rem)、同样 1.75rem 大;垂直居中于标题 + 副标题那两行(pt 0.75rem + (2.25rem − 1.75rem)/2) */
.route-head-icon {
  position: absolute;
  left: 0.9rem;
  top: 1rem;
  width: 1.75rem;
  height: 1.75rem;
}
.route-head {
  background-color: var(--color-base-100);
  border-top-left-radius: var(--app-radius-box, 1rem);
  border-top-right-radius: var(--app-radius-box, 1rem);
  border-bottom: 1px solid color-mix(in srgb, var(--color-base-300) 60%, transparent);
}
@media (min-width: 768px) {
  .route-cell {
    order: 0;
  }
}
</style>
