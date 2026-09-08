<template>
  <!-- 规则页顶上的访问路径:左边「规则路由」按查询条件推算,右边「真实路由」是面板自己发起的一次测试。
       两列都是同一套五站、自下而上(① 发起访问 → ⑤ 最终出口),同一站左右同一行。
       整块是一个网格:桌面两列,每一行是同一站的左右两格,所以展开详情时另一列同一站跟着变高、始终对齐;
       窄屏改成单列,按 --m-order 先排完左列再排右列,各自还是从下往上。没有外层卡片和说明文字,
       两列各自就是一张卡(列头圆角 + 最底下一格圆角)。 -->
  <!-- text-sm:整块的基准字号,大字(font-medium)、ProxyName / ProxyGroupNow 的名字和 16px 图标都按它对齐 -->
  <div class="route-grid grid grid-cols-1 gap-x-3 text-sm md:grid-cols-2">
        <!-- 列头:左 = 规则路由 · 依据查询条件推算;右 = 真实路由 · 面板自身发起的测试 -->
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
            <div class="text-base-content/50 text-xs">{{ $t('routeCmpActualSub') }}</div>
          </div>
          <div class="ml-auto flex shrink-0 items-center gap-1">
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
            <span class="text-warning font-medium">{{ $t('routeExitPending') }}</span>
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
            <p class="text-warning">{{ $t('penetrationChainError', { message: rule.chainError }) }}</p>
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
          <template v-else-if="!actual">
            <span class="text-base-content/50 text-xs">{{ actualLoading ? $t('routeExitStatusTesting') : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else>
            <!-- 链路、HTTP 状态、结果文字放在同一个行盒里,垂直居中对齐;目标 IP / IPv6 结果 / 节点怎么连进「连接详情」 -->
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <template v-if="actual.exit.chains?.length">
                <template
                  v-for="(hop, i) in actual.exit.chains"
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
                v-if="actual.exit.status !== undefined"
                class="badge badge-sm"
                :class="toneClass(statusTone(actual.exit.status))"
              >HTTP {{ actual.exit.status }}</span>
              <span
                v-if="actual.exit.status !== undefined"
                class="text-base-content/70 text-xs"
              >{{ statusText(actual.exit.status) }}</span>
              <span
                v-if="actual.exit.error"
                class="text-error text-xs"
              >{{ $t('routeTestRequestFailed', { message: errorText(actual.exit.error) }) }}</span>
            </div>
          </template>
          <template
            v-if="actual && !actualError && (actualExitIp || actual.exit6 || exitNodeNote)"
            #details
          >
            <p
              v-if="actualExitIp"
              class="font-mono"
            >{{ $t('routeExitTarget', { ip: actualExitIp }) }}</p>
            <p
              v-if="actual.exit6"
              :class="actual.exit6.ok ? '' : 'text-warning'"
            >IPv6 <span class="font-mono">{{ actual.exit6.connectTo }}</span>: {{ actual.exit6.ok ? `HTTP ${actual.exit6.status} · ${actual.exit6.ms}ms` : $t('routeTestRequestFailed', { message: errorText(actual.exit6.error || '') }) }}</p>
            <p
              v-if="exitNodeNote"
              :class="exitNodeNote.warn ? 'text-warning' : ''"
            >{{ exitNodeNote.text }}</p>
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
          :details-title="ruleMatch.state === 'pending' ? $t('routeRuleWhy') : $t('routeRuleDetail')"
        >
          <template v-if="!rule || ruleError">
            <span class="text-base-content/50 text-xs">{{ ruleError ? '—' : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else-if="rule.matchError && rule.undetermined">
            <span class="text-warning font-medium">{{ $t('routeRuleMissing', { needs: needsText }) }}</span>
            <span class="text-base-content/60 text-xs">{{ $t('routeRuleUndetermined', { index: rule.undetermined.index + 1, needs: needsText }) }}</span>
          </template>
          <template v-else-if="rule.matchError">
            <span class="text-warning font-medium">{{ $t('penetrationRuleUnknown') }}</span>
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
            <span
              v-if="rule.routingStale"
              class="text-warning basis-full text-xs"
            >{{ $t('ruleLookupRoutingStale') }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ $t('routeRuleNoMatchFallback') }}</span>
            <span
              v-if="rule.routingStale"
              class="text-warning basis-full text-xs"
            >{{ $t('ruleLookupRoutingStale') }}</span>
          </template>
          <template
            v-if="rule && ((rule.matchError && rule.undetermined) || rule.matched)"
            #details
          >
            <p v-if="rule.matchError && rule.undetermined">{{ $t('routeRuleWhyBody', { needs: needsText }) }}</p>
            <template v-else>
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
          <template v-if="!actual || actualError">
            <span class="text-base-content/50 text-xs">{{ actualError ? '—' : actualLoading ? $t('routeExitStatusTesting') : $t('routeCmpWaiting') }}</span>
          </template>
          <!-- 和左列同一个结构:第一行"连接归属 + 站点集名"(对应左列的"站点集 + 名字"),内核的规则原文在「规则详情」里 -->
          <template v-else-if="actualOwner || actual.exit.rule">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-base-content/60 text-xs">{{ $t('routeRuleOwnerLabel') }}</span>
              <ProxyName
                v-if="actualOwner && proxyMap[actualOwner]"
                :name="actualOwner"
                class="font-medium"
              />
              <span
                v-else-if="actualOwner"
                class="font-medium"
              >{{ actualOwner }}</span>
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
            v-if="actual && !actualError"
            #details
          >
            <p
              v-if="actual.exit.rule"
              class="text-base-content/50 font-mono text-[11px] break-all"
            >{{ actual.exit.rule }}</p>
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
            <span
              class="font-medium"
              :class="ruleEntry.state === 'pending' ? 'text-warning' : ''"
            >{{ ruleEntry.value }}</span>
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
          :details-title="$t('routeEntryInboundDiff')"
        >
          <template v-if="!actual || actualError">
            <span class="text-base-content/50 text-xs">{{ actualError ? '—' : actualLoading ? $t('routeExitStatusTesting') : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else>
            <span
              class="font-medium"
              :class="actualEntry.state === 'pending' ? 'text-warning' : ''"
            >{{ actualEntry.value }}</span>
            <span class="text-base-content/60 text-xs">{{ actualEntry.sub }}</span>
          </template>
          <template
            v-if="actual && !actualError && !dnsSkipped"
            #details
          >
            <p>{{ $t('routeTestDomainTargetNote') }}</p>
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
            <span class="text-warning font-medium">{{ $t('routeDnsUnknown') }}</span>
            <span class="text-base-content/60 text-xs">{{ ruleDns.message }}</span>
          </template>
          <template v-else-if="ruleDns.kind === 'reject'">
            <span class="badge badge-sm badge-error badge-soft w-fit">{{ $t('penetrationBlockedTitle') }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ ruleDns.viaProxy ? $t('routeTestDnsProxy') : $t('routeTestDnsDirect') }}</span>
            <span class="text-base-content/60 font-mono text-xs">{{ ruleDns.serverLine }}</span>
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
          <template v-if="!actual || actualError">
            <span class="text-base-content/50 text-xs">{{ actualError ? '—' : actualLoading ? $t('routeExitStatusTesting') : $t('routeCmpWaiting') }}</span>
          </template>
          <template v-else-if="actualDns.kind === 'skip'">
            <span class="font-medium">{{ $t('routeDnsNone') }}</span>
            <span class="text-base-content/60 text-xs">{{ $t('routeDnsNoneSub', { kind: kindText }) }}</span>
          </template>
          <template v-else-if="actualDns.kind === 'error'">
            <span class="text-warning font-medium">{{ $t('routeDnsUnknown') }}</span>
            <span class="text-base-content/60 text-xs">{{ actualDns.message }}</span>
          </template>
          <template v-else-if="actualDns.kind === 'reject'">
            <span class="badge badge-sm badge-error badge-soft w-fit">{{ $t('penetrationBlockedTitle') }}</span>
          </template>
          <template v-else>
            <span class="font-medium">{{ actualDns.viaProxy ? $t('routeTestDnsProxy') : $t('routeTestDnsDirect') }}</span>
            <span class="text-base-content/60 font-mono text-xs">{{ actualDns.serverLine }}</span>
            <!-- IPv4 / IPv6 分开说、排在第二行:v4 成功了不能因为 AAAA 为空写成"没有解析结果";
                 档案没开 IPv6 的"未查询"不占这一行,放进解析记录里 -->
            <span
              class="basis-full"
              aria-hidden="true"
            />
            <span
              v-if="actualDns.v4"
              class="text-xs"
              :class="actualDns.v4.tone === 'pending' ? 'text-warning' : actualDns.v4.tone === 'good' ? 'text-success' : 'text-base-content/60'"
            >{{ actualDns.v4.text }}</span>
            <span
              v-if="actualDns.v6 && actualDns.v6.queried"
              class="text-xs"
              :class="actualDns.v6.tone === 'pending' ? 'text-warning' : actualDns.v6.tone === 'good' ? 'text-success' : 'text-base-content/60'"
            >· {{ actualDns.v6.text }}</span>
            <span
              v-if="actualDns.stale"
              class="text-warning basis-full text-xs"
            >{{ actualDns.stale }}</span>
          </template>
          <template
            v-if="actualDns.kind === 'decision'"
            #details
          >
            <p v-if="actualDns.v6 && !actualDns.v6.queried">{{ actualDns.v6.text }}</p>
            <p><span class="text-base-content/50">{{ $t('routeDnsResolver') }}</span> <span class="font-mono">{{ actualDns.tag }}</span></p>
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
              :class="note.warn ? 'text-warning' : ''"
            >{{ note.text }}</p>
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
          :badge="kindText"
          badge-tone="muted"
          :details-title="$t('routeStartSourceTitle')"
          first
        >
          <span class="font-medium">{{ $t('routeStartPanel') }}</span>
          <span
            v-if="actual?.exit.url"
            class="text-base-content/60 font-mono text-xs break-all"
          >{{ actual.exit.url }}</span>
          <span
            v-else
            class="text-base-content/60 text-xs"
          >{{ target }}{{ port ? `:${port}` : '' }}</span>
          <template #details>
            <p>{{ $t('routeStartPanelDetail') }}</p>
            <p
              v-if="actual?.context"
              class="text-warning"
            >{{ $t('routeTestSourceNotProbed', { ip: actual.context.sourceIp }) }}</p>
          </template>
        </RouteStage>

  </div>
</template>

<script setup lang="ts">
import type { OpenboxPenetrationResult, OpenboxRouteTest } from '@/api/openbox'
import { queryPenetration, testRoute } from '@/api/openbox'
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

// ---------- 真实路由(面板自己测一次) ----------
const actual = ref<OpenboxRouteTest | null>(null)
const actualLoading = ref(false)
const actualError = ref('')
let actualTimer = 0
let actualSeq = 0
const runActual = async () => {
  const mine = ++actualSeq
  actualLoading.value = true
  actualError.value = ''
  try {
    const r = await testRoute(props.target, props.port ?? undefined)
    if (mine !== actualSeq) return
    actual.value = r
  } catch (err) {
    if (mine !== actualSeq) return
    actual.value = null
    actualError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (mine === actualSeq) actualLoading.value = false
  }
}
// 真实访问一次是有代价的(出网、占一条连接),等输入停下 600ms 再跑
watch(
  () => [props.target, props.port] as const,
  () => {
    window.clearTimeout(actualTimer)
    actual.value = null
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
  serverLine?: string
  tag?: string
  detour?: string
  v4?: { text: string; tone: Tone }
  // queried:档案开了 IPv6、这次真的查了 AAAA;没查的(未开启 IPv6)不占主行,进详情
  v6?: { text: string; tone: Tone; queried: boolean }
  notes?: Array<{ text: string; warn?: boolean }>
  chain?: string[]
  answers?: string[]
  answers6?: string[]
  stale?: string
}
const toneClass = (tone: Tone | undefined) => {
  switch (tone) {
    case 'good': return 'badge-success badge-soft'
    case 'proxy': return 'badge-info badge-soft'
    case 'pending': return 'badge-warning badge-soft'
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
  if (/timeout/i.test(raw)) return t('routeTestErrTimeout')
  if (/^inbound:/i.test(raw)) return t('routeTestErrInbound')
  if (/^CONNECT:/i.test(raw)) return t('routeTestErrConnect', { detail: raw.replace(/^CONNECT:\s*/i, '') })
  if (/connection closed|ECONNRESET/i.test(raw)) return t('routeTestErrClosed')
  return raw
}

// ---------- 左列:规则路由 ----------
const ruleOutbound = computed(() => rule.value?.finalOutbound || '')
const ruleOwner = computed(() => rule.value?.matched?.ownerName || '')
// 具体命中的第一条条目(规则集解码出来的,或站点集里手写的),跟在站点集名后面显示
const firstEntry = computed(() => rule.value?.matched?.entries?.[0] || null)
const ruleReject = computed(() => rule.value?.matched?.action === 'reject')
const needsText = computed(() => {
  const needs = rule.value?.undetermined?.needs || []
  const words = needs.map((n) => t(n === 'sourceIp' ? 'routeNeedSourceIp' : n === 'port' ? 'routeNeedPort' : 'routeNeedIpVersion'))
  return words.join(t('routeNeedJoin'))
})
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
  if (rule.value.matchError) return { text: t(rule.value.undetermined ? 'routeCmpPillIncomplete' : 'routeCmpPillUnknown'), tone: 'pending' }
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
  if (r.matchError) return { state: 'pending', badge: t(r.undetermined ? 'routeRulePending' : 'penetrationRuleUnknown'), tone: 'pending' }
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

// ---------- 右列:真实路由 ----------
const dnsSkipped = computed(() => Boolean(actual.value && actual.value.dns && 'skipped' in actual.value.dns))
const actualDecision = computed(() => {
  const d = actual.value?.dns
  return d && 'ruleIndex' in d ? d : null
})
const actualExitIp = computed(() => actual.value?.exit.destinationIP || actual.value?.exit.connectTo || '')
const actualOwner = computed(() => actual.value?.exit.chains?.[0] || '')
const actualPill = computed<{ text: string; tone: Tone }>(() => {
  if (actualError.value) return { text: t('routeCmpPillFailed'), tone: 'error' }
  const e = actual.value?.exit
  if (!e) return { text: t('routeExitStatusTesting'), tone: 'muted' }
  if (e.error) return { text: t('routeExitStatusFailed'), tone: 'error' }
  if (e.status !== undefined && e.status < 300) return { text: t('routeExitStatusSuccess'), tone: 'good' }
  if (e.status !== undefined && e.status < 400) return { text: t('routeExitStatusReachable'), tone: 'good' }
  if (e.status !== undefined) return { text: t('routeExitStatusReachable'), tone: 'pending' }
  return { text: t('routeExitStatusPending'), tone: 'pending' }
})
// 本地这次解析的答案是线路对端的 fake-ip:应答者就是 detour 此刻落到的那个节点
const fakeIpHop = computed(() => (actual.value?.resolve?.fakeIp && !actual.value.resolve.fakeIpLocal && actual.value.resolve.fakeIpFrom) || '')
const actualDns = computed<DnsView>(() => {
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
    v4, v6, notes, chain, answers, answers6,
    stale: d.stale ? t(d.stale === 'direct' ? 'routeTestDnsStaleDirect' : 'routeTestDnsStaleProxy') : '',
  }
})
// ③ 右:只有连接表里认出了这条连接,才能说"经过了内核"
const actualEntry = computed(() => {
  const e = actual.value?.exit
  if (!e || actualError.value) return { state: 'ok' as RouteStageState, value: '', sub: '', badge: undefined as string | undefined, tone: 'muted' as Tone }
  if (e.chains?.length || e.rule || e.destinationIP) return { state: 'ok' as RouteStageState, value: t('routeEntryPanelInbound'), sub: t('routeEntryPanelKernel'), badge: t('routeEntryEntered'), tone: 'good' as Tone }
  if (e.error && /^inbound:/i.test(e.error)) return { state: 'pending' as RouteStageState, value: t('routeEntryUnknown'), sub: t('routeTestErrInbound'), badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
  if (e.notSeen) return { state: 'pending' as RouteStageState, value: t('routeEntryPanelNotSeen'), sub: t(e.error ? 'routeTestNotSeenFailed' : 'routeTestNotSeen'), badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
  return { state: 'pending' as RouteStageState, value: t('routeEntryUnknown'), sub: e.connectionsError || '', badge: t('routeEntryUnknown'), tone: 'pending' as Tone }
})
const actualRule = computed<{ state: RouteStageState; badge?: string; tone: Tone }>(() => {
  const e = actual.value?.exit
  if (!e || actualError.value) return { state: 'ok', tone: 'muted' }
  if (e.rule || e.chains?.length) return { state: 'ok', badge: t('routeRuleRecord'), tone: 'muted' }
  return { state: 'pending', badge: t('routeEntryUnknown'), tone: 'pending' }
})
const actualExit = computed<{ state: RouteStageState; badge?: string; tone: Tone }>(() => {
  const e = actual.value?.exit
  if (!e || actualError.value) return { state: 'ok', tone: 'muted' }
  const badge = e.ms !== undefined ? `${e.ms} ms` : undefined
  if (e.error) return { state: 'pending', badge, tone: 'error' }
  if (e.status !== undefined && e.status >= 400) return { state: 'ok', badge, tone: 'pending' }
  return { state: 'ok', badge, tone: 'good' }
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
</script>

<style scoped>
.route-cell {
  order: var(--m-order);
  border-color: color-mix(in srgb, var(--color-base-300) 60%, transparent);
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
