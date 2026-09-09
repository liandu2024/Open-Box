<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="loading && !groups.length"
      class="flex justify-center py-10"
    >
      <span class="loading loading-spinner loading-md" />
    </div>

    <!-- 顺序有意义:生成配置时按这个顺序出策略组,内核和代理页里的排列跟着它走。
         handle 限定在那个图标上——不限定的话,按住卡片任意处都会开始拖,连"编辑"
         按钮都不好点了。 -->
    <Draggable
      v-else
      v-model="groups"
      :animation="150"
      :force-fallback="true"
      :fallback-on-body="true"
      handle=".drag-handle"
      ghost-class="opacity-40"
      item-key="id"
      class="flex flex-col gap-2"
      @end="persistOrder"
    >
      <template #item="{ element: group }">
      <div
        class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border p-3"
        :class="group.enabled === false && 'opacity-50'"
      >
        <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
        <CountryFlag
          v-if="group.icon"
          :code="group.icon"
          :size="18"
          :scale="group.iconScale"
          :title="group.icon"
        />
        <div class="min-w-0 flex-1">
          <!-- 窄屏上名字和类型标签放不下一行就让标签换到下一行,不要把名字挤成「所有…」、
               标签自己折成两行叠在名字上 -->
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="max-w-full truncate text-base font-medium">{{ group.name }}</span>
            <span
              v-if="group.kind"
              class="badge badge-ghost badge-sm shrink-0 whitespace-nowrap"
            >{{ $t('groupBuiltinBadge') }}</span>
            <span
              v-else
              class="badge badge-outline badge-sm shrink-0 whitespace-nowrap"
            >{{ $t(`groupType_${group.type}`) }}</span>
            <StatusBadge
              v-if="group.enabled === false"
              :on="false"
              on-text=""
              :off-text="$t('groupDisabledBadge')"
            />
          </div>
          <div class="text-base-content/60 mt-0.5 text-xs">
            <template v-if="group.kind">
              {{ $t(group.kind === 'direct' ? 'groupBuiltinDirectSummary' : 'groupBuiltinBlockSummary') }}
            </template>
            <template v-else>
              {{ memberSummary(group) }}
              <template v-if="group.type === 'urltest' || group.type === 'failover'">
                · {{ $t('groupInterval') }} {{ group.interval }} · {{ $t('groupTolerance') }} {{ group.tolerance }}ms
              </template>
            </template>
          </div>
        </div>
        <!-- 启用/停用:停用 = 不写进配置、站点集里选不到。放在编辑前面。 -->
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :class="group.enabled === false ? 'text-base-content/40' : 'text-success'"
          :aria-label="$t(group.enabled === false ? 'groupEnable' : 'groupDisable')"
          v-tip="$t(group.enabled === false ? 'groupEnable' : 'groupDisable')"
          :disabled="toggling === group.id"
          @click="toggleEnabled(group)"
        >
          <PowerIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :aria-label="$t('groupEdit')"
          @click="group.kind ? openBuiltinEditor(group) : openEditor(group)"
        >
          <PencilSquareIcon class="h-4 w-4" />
        </button>
        <!-- 内置的直连/拒绝删不掉:内核离不开 direct,拒绝是站点集里「拒绝」的实体。
             按钮照样摆着(置灰、不可点),每一行的按钮列才对得齐。 -->
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :class="group.kind ? 'text-base-content/30 cursor-not-allowed' : 'hover:text-error'"
          :aria-disabled="Boolean(group.kind) || undefined"
          :aria-label="$t('delete')"
          v-tip="group.kind ? $t('groupBuiltinNoDelete') : $t('delete')"
          @click="!group.kind && askDelete(group)"
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </div>
      </template>
    </Draggable>

    <DialogWrapper
      v-model="showBuiltinEditor"
      :title="$t('groupEditTitle')"
      box-class="w-full max-w-2xl"
    >
      <div
        v-if="builtinDraft"
        class="flex flex-col gap-4"
      >
        <div class="flex items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupIconLabel') }}</label>
            <div class="w-56">
              <CountrySelect
                v-model="builtinDraft.icon"
                clearable
                globes
                brands
                :placeholder="$t('groupIconNone')"
              />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('iconScaleLabel') }}</label>
            <IconScaleInput v-model="builtinDraft.iconScale" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupNameLabel') }}</label>
            <input
              v-model="builtinDraft.name"
              type="text"
              class="input input-sm w-full"
            />
          </div>
        </div>
        <p class="text-base-content/50 text-xs">{{ $t('groupBuiltinEditHint') }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showBuiltinEditor = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="saving"
            @click="saveBuiltin"
          >
            <span
              v-if="saving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('subscriptionSave') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <DialogWrapper
      v-model="showEditor"
      :title="$t(editing?.id ? 'groupEditTitle' : 'groupAddTitle')"
      box-class="w-full max-w-2xl"
    >
      <div
        v-if="draft"
        class="flex flex-col gap-4"
      >
        <div class="flex items-end gap-2">
          <!-- 图标:和地区关键词那边同一个国旗选择器。节点组多半就是按国家/地区分的
               (香港-自动、台湾-自动),给它配一面旗,列表里一眼就找得到。 -->
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupIconLabel') }}</label>
            <!-- w-56:公司名(Google 云端硬盘)和通用图标名(拒绝(停止))比国名长得多,窄了就截断 -->
            <div class="w-56">
              <CountrySelect
                v-model="draft.icon"
                clearable
                globes
                brands
                :placeholder="$t('groupIconNone')"
              />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('iconScaleLabel') }}</label>
            <IconScaleInput v-model="draft.iconScale" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupNameLabel') }}</label>
            <input
              v-model="draft.name"
              type="text"
              class="input input-sm w-full"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupTypeLabel') }}</label>
            <select
              v-model="draft.type"
              class="select select-sm"
              @change="onTypeChange"
            >
              <option value="urltest">{{ $t('groupType_urltest') }}</option>
              <option value="selector">{{ $t('groupType_selector') }}</option>
              <option value="failover">{{ $t('groupType_failover') }}</option>
            </select>
          </div>
          <!-- 故障转移:检测间隔按秒填(30 秒一轮健康检查,不是分钟级的择优测速);容差只给多节点页签里的
               内部自动择优用,页签全是单节点时没有用武之地,置灰说明;超时 / 失败轮数 / 回切收进高级设置 -->
          <template v-if="isFailover">
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium">{{ $t('groupInterval') }}</label>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="intervalSeconds"
                  type="number"
                  min="5"
                  max="86400"
                  class="input input-sm w-20"
                />
                <span class="text-base-content/60 text-xs">{{ $t('groupUnitSecond') }}</span>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label
                class="text-xs font-medium"
                v-tip="allLanesSingle ? $t('failoverToleranceUnused') : $t('failoverToleranceHint')"
              >{{ $t('failoverTolerance') }}</label>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="draft.tolerance"
                  type="number"
                  min="0"
                  class="input input-sm w-20"
                  :disabled="allLanesSingle"
                />
                <span class="text-base-content/60 text-xs">{{ $t('groupUnitMs') }}</span>
              </div>
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label class="text-xs font-medium">{{ $t('groupTestUrl') }}</label>
              <input
                v-model="draft.testUrl"
                type="url"
                class="input input-sm w-full font-mono text-xs"
                :placeholder="$t('groupTestUrlPlaceholder')"
              />
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="showAdvanced = !showAdvanced"
            >
              {{ $t('failoverAdvanced') }}
              <ChevronDownIcon :class="['h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180']" />
            </button>
          </template>
          <!-- 检测间隔/容差只对 urltest 有意义:selector 是手动选,不会自己去测 -->
          <template v-else-if="draft.type === 'urltest'">
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium">{{ $t('groupInterval') }}</label>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="intervalMinutes"
                  type="number"
                  min="1"
                  class="input input-sm w-20"
                />
                <span class="text-base-content/60 text-xs">{{ $t('groupUnitMinute') }}</span>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium">{{ $t('groupTolerance') }}</label>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="draft.tolerance"
                  type="number"
                  min="0"
                  class="input input-sm w-20"
                />
                <span class="text-base-content/60 text-xs">{{ $t('groupUnitMs') }}</span>
              </div>
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label class="text-xs font-medium">{{ $t('groupTestUrl') }}</label>
              <input
                v-model="draft.testUrl"
                type="url"
                class="input input-sm w-full font-mono text-xs"
                :placeholder="$t('groupTestUrlPlaceholder')"
              />
            </div>
          </template>
        </div>
        <div
          v-if="isFailover && showAdvanced && failoverSettings"
          class="bg-base-200/60 flex flex-wrap items-end gap-3 rounded-lg px-3 py-2"
        >
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('failoverTimeout') }}</label>
            <div class="flex items-center gap-1">
              <input
                v-model.number="timeoutSeconds"
                type="number"
                min="1"
                max="60"
                class="input input-sm w-20"
              />
              <span class="text-base-content/60 text-xs">{{ $t('groupUnitSecond') }}</span>
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label
              class="text-xs font-medium"
              v-tip="$t('failoverThresholdHint')"
            >{{ $t('failoverThreshold') }}</label>
            <div class="flex items-center gap-1">
              <input
                v-model.number="failoverSettings.failureThreshold"
                type="number"
                min="1"
                max="20"
                class="input input-sm w-20"
              />
              <span class="text-base-content/60 text-xs">{{ $t('failoverUnitRound') }}</span>
            </div>
          </div>
          <label class="flex cursor-pointer items-center gap-2 pb-1.5">
            <input
              v-model="failoverSettings.restorePrimary"
              type="checkbox"
              class="toggle toggle-sm"
            />
            <span
              class="text-xs font-medium"
              v-tip="$t('failoverRestoreHint')"
            >{{ $t('failoverRestore') }}</span>
          </label>
          <div
            v-if="failoverSettings.restorePrimary"
            class="flex flex-col gap-1"
          >
            <label
              class="text-xs font-medium"
              v-tip="$t('failoverHoldHint')"
            >{{ $t('failoverHold') }}</label>
            <div class="flex items-center gap-1">
              <input
                v-model.number="recoveryHoldSeconds"
                type="number"
                min="0"
                max="86400"
                class="input input-sm w-20"
              />
              <span class="text-base-content/60 text-xs">{{ $t('groupUnitSecond') }}</span>
            </div>
          </div>
        </div>
        <!-- 从普通组切成故障转移时,原来引用了组的成员进不了页签(页签只放真实节点):列出来、拦住保存,
             由用户决定是移除它们还是切回原类型;不悄悄展开也不悄悄丢 -->
        <div
          v-if="isFailover && blockedMembers.length"
          class="fo-note flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
        >
          <span class="min-w-0 flex-1">{{ $t('failoverBlockedMembers', { members: blockedMembers.join('、') }) }}</span>
          <button
            type="button"
            class="btn btn-xs"
            @click="blockedMembers = []"
          >
            {{ $t('failoverDropBlocked') }}
          </button>
        </div>
        <!-- 成员怎么来:动态组按关键词现算,静态组手工挑。放在这儿是因为下面整块
             (穿梭框 / 关键词框)都归它管。故障转移只有静态一种,不给切换 -->
        <p
          v-if="isFailover"
          class="text-base-content/60 text-xs"
        >{{ $t('failoverStaticHint') }}</p>
        <div
          v-else
          role="tablist"
          class="tabs-box tabs tabs-sm w-fit"
        >
          <a
            role="tab"
            :class="['tab', draft.mode === 'dynamic' && 'tab-active']"
            @click="draft.mode = 'dynamic'"
          >
            {{ $t('groupModeDynamic') }}
          </a>
          <a
            role="tab"
            :class="['tab', draft.mode === 'static' && 'tab-active']"
            @click="draft.mode = 'static'"
          >
            {{ $t('groupModeStatic') }}
          </a>
        </div>

        <!-- 左右穿梭:左边是还没选的,右边是已选的,中间两个箭头搬运勾中的条目。
             每行的勾选框只表示"这条要不要搬",与"选没选中它当成员"是两回事——后者
             由它在左边还是右边表示,所以不会出现"几十个节点混在一列里看不出选了谁"
             的老问题。行末的 › ‹ 是单条快捷键:不用先勾再按箭头,一下就挪过去。 -->
        <div
          v-if="draft.mode === 'static'"
          class="grid grid-cols-[1fr_auto_1fr] gap-3"
        >
            <div class="border-base-content/10 flex min-h-0 flex-col rounded-lg border">
              <div class="border-base-content/10 flex flex-col gap-1 border-b px-2 py-1.5">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium whitespace-nowrap">
                    {{ $t('groupAvailable') }} ({{ availableCandidates.length }})
                  </span>
                  <input
                    v-model="memberFilter"
                    type="text"
                    class="input input-xs min-w-0 flex-1"
                    :placeholder="$t('groupMemberFilter')"
                  />
                </div>
                <BulkPick
                  v-model:subscription="memberSub"
                  :subscriptions="subscriptionOptions"
                  :nodes-only="isFailover"
                  @select-all="tickAll('available')"
                  @invert="tickInvert('available')"
                  @clear="tickNone('available')"
                />
              </div>
              <div class="max-h-64 overflow-y-auto">
                <p
                  v-if="!filteredAvailable.length"
                  class="text-base-content/50 p-3 text-center text-xs"
                >
                  {{ $t('groupNoCandidates') }}
                </p>
                <label
                  v-for="item in filteredAvailable"
                  :key="item.kind + item.name"
                  class="hover:bg-base-200/60 flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm"
                >
                  <input
                    v-model="checkedAvailable"
                    type="checkbox"
                    class="checkbox checkbox-xs shrink-0"
                    :value="item.name"
                  />
                  <span class="truncate">{{ item.name }}</span>
                  <span
                    v-if="item.kind === 'group'"
                    class="badge badge-ghost badge-xs"
                  >{{ $t('groupsTab') }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs ml-auto shrink-0 px-1"
                    v-tip="$t('groupMoveRight')"
                    @click.prevent="addMember(item.name)"
                  >
                    <ChevronRightIcon class="text-base-content/30 h-4 w-4" />
                  </button>
                </label>
              </div>
            </div>

            <!-- 中间的搬运按钮:把勾中的条目整批挪过去。没勾任何东西时置灰,
                 免得按下去什么都不发生还以为是坏的。 -->
            <div class="flex flex-col items-center justify-center gap-2">
              <button
                type="button"
                class="btn btn-sm btn-square"
                :disabled="!checkedAvailable.length"
                v-tip="$t('groupMoveRight')"
                @click="moveRight"
              >
                <ChevronRightIcon class="h-4 w-4" />
              </button>
              <button
                type="button"
                class="btn btn-sm btn-square"
                :disabled="!checkedSelected.length"
                v-tip="$t('groupMoveLeft')"
                @click="moveLeft"
              >
                <ChevronLeftIcon class="h-4 w-4" />
              </button>
            </div>

            <div class="border-base-content/10 flex min-h-0 min-w-0 flex-col rounded-lg border">
              <!-- 故障转移:右侧上方是主备页签。顺序即优先级(第一个主用,后面依次备用),拖拽排序;
                   页签按稳定 id 认,拖完选中的还是原来那个;多了在容器内横向滚动,不把弹窗撑宽 -->
              <template v-if="isFailover && draft.lanes">
                <div class="border-base-content/10 flex min-w-0 items-center gap-1 border-b px-2 py-1.5">
                  <Draggable
                    v-model="draft.lanes"
                    :animation="150"
                    :force-fallback="true"
                    :fallback-on-body="true"
                    ghost-class="opacity-40"
                    item-key="id"
                    class="flex min-w-0 flex-1 gap-1 overflow-x-auto"
                  >
                    <template #item="{ element: lane, index }">
                      <button
                        type="button"
                        :class="['btn btn-xs shrink-0 cursor-move whitespace-nowrap', lane.id === activeLaneId ? 'btn-primary' : 'btn-ghost border-base-content/15 border']"
                        @click="selectLane(lane.id)"
                      >
                        <!-- 页签栏只标角色和有效节点数;自定义名在下面当前页签那行改,不占页签栏的宽度 -->
                        {{ laneRoleLabel(index) }}
                        <span class="opacity-70 tabular-nums">· {{ validCount(lane) }}</span>
                      </button>
                    </template>
                  </Draggable>
                  <!-- 最多 3 个页签(主用 + 备用 1 + 备用 2),满了加号置灰 -->
                  <button
                    type="button"
                    class="btn btn-ghost btn-square btn-xs shrink-0"
                    :disabled="draft.lanes.length >= FAILOVER_MAX_LANES"
                    :aria-label="$t('failoverAddLane')"
                    v-tip="draft.lanes.length >= FAILOVER_MAX_LANES ? $t('failoverMaxLanes', { n: FAILOVER_MAX_LANES }) : $t('failoverAddLane')"
                    @click="addLane"
                  >
                    <PlusIcon class="h-4 w-4" />
                  </button>
                </div>
                <!-- 当前页签一行:图标(默认显示分组的图标,单独挑了才存自己的)· 页签名 · 删除。顺序靠拖页签调 -->
                <div
                  v-if="activeLane"
                  class="border-base-content/10 flex min-w-0 items-center gap-1 border-b px-2 py-1 text-xs"
                >
                  <div class="w-32 shrink-0">
                    <CountrySelect
                      v-model="activeLaneIcon"
                      clearable
                      globes
                      brands
                      :placeholder="$t('groupIconLabel')"
                    />
                  </div>
                  <input
                    v-model="activeLane.name"
                    type="text"
                    class="input input-sm min-w-0 flex-1"
                    :placeholder="$t('failoverLaneNamePlaceholder')"
                  />
                  <button
                    type="button"
                    class="btn btn-ghost btn-square btn-sm shrink-0 hover:text-error"
                    :aria-label="$t('failoverDeleteLane')"
                    v-tip="$t('failoverDeleteLane')"
                    @click="askDeleteLane(activeLane)"
                  >
                    <TrashIcon class="h-4 w-4" />
                  </button>
                </div>
              </template>
              <div class="border-base-content/10 flex flex-col gap-1 border-b px-2 py-1.5">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium whitespace-nowrap">
                    {{ $t('groupSelected') }} ({{ members.length }})
                  </span>
                  <input
                    v-model="selectedFilter"
                    type="text"
                    class="input input-xs min-w-0 flex-1"
                    :placeholder="$t('groupMemberFilter')"
                  />
                </div>
                <BulkPick
                  v-model:subscription="selectedSub"
                  :subscriptions="subscriptionOptions"
                  :nodes-only="isFailover"
                  @select-all="tickAll('selected')"
                  @invert="tickInvert('selected')"
                  @clear="tickNone('selected')"
                />
              </div>
              <div class="max-h-64 overflow-y-auto">
                <p
                  v-if="!filteredSelected.length"
                  class="text-base-content/50 p-3 text-center text-xs"
                >
                  {{ $t('groupNoSelected') }}
                </p>
                <label
                  v-for="name in filteredSelected"
                  :key="name"
                  class="hover:bg-base-200/60 flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm"
                >
                  <input
                    v-model="checkedSelected"
                    type="checkbox"
                    class="checkbox checkbox-xs shrink-0"
                    :value="name"
                  />
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs shrink-0 px-1"
                    v-tip="$t('groupMoveLeft')"
                    @click.prevent="removeMember(name)"
                  >
                    <ChevronLeftIcon class="text-base-content/30 h-4 w-4" />
                  </button>
                  <span :class="['truncate', isFailover && !nodeNameSet.has(name) && 'line-through opacity-60']">{{ name }}</span>
                  <!-- 订阅更新后已经不存在的节点:留着给用户看,不算有效节点、不进配置 -->
                  <span
                    v-if="isFailover && !nodeNameSet.has(name)"
                    class="badge badge-ghost badge-xs shrink-0"
                  >{{ $t('failoverInvalid') }}</span>
                </label>
              </div>
            </div>
        </div>

        <!-- 动态组:成员不落名单,只存关键词,生成配置时按当前节点现算。这样以后新加
             的订阅,只要节点名命中关键词,下次部署就自动进这个组,不用回来重勾一遍。
             下面实时列出"按现在的节点会选中谁",免得关键词写完还得靠猜。 -->
        <div
          v-else
          class="flex flex-col gap-2"
        >
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupKeywordsLabel') }}</label>
            <input
              v-model="keywordsText"
              type="text"
              class="input input-sm w-full"
              :placeholder="$t('groupKeywordsPlaceholder')"
            />
            <p class="text-base-content/50 text-xs">{{ $t('groupKeywordsHint') }}</p>
          </div>
          <div class="border-base-content/10 rounded-lg border">
            <div class="border-base-content/10 border-b px-3 py-1.5 text-xs font-medium">
              {{ $t('groupDynamicMatched', { count: dynamicMatched.length }) }}
            </div>
            <div class="max-h-56 overflow-y-auto">
              <p
                v-if="!dynamicMatched.length"
                class="text-base-content/50 p-3 text-center text-xs"
              >
                {{ $t('groupDynamicNoMatch') }}
              </p>
              <div
                v-for="name in dynamicMatched"
                :key="name"
                class="px-3 py-1.5 text-sm"
              >
                <span class="truncate">{{ name }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showEditor = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="saving"
            @click="saveDraft()"
          >
            <span
              v-if="saving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('subscriptionSave') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <!-- 删有成员的页签先确认(草稿内的动作,取消整个弹窗也不会落库) -->
    <DialogWrapper
      v-model="showLaneDelete"
      :title="$t('failoverDeleteLane')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('failoverDeleteLaneConfirm', { lane: pendingLane ? laneLabelOf(pendingLane) : '', count: pendingLane?.members.length ?? 0 }) }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showLaneDelete = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            @click="confirmDeleteLane"
          >
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <!-- 已保存的故障转移组改成普通类型再保存:主备层次会丢,明确确认一次 -->
    <DialogWrapper
      v-model="showTypeChangeConfirm"
      :title="$t('failoverTypeChangeTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">{{ $t('failoverTypeChangeConfirm') }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showTypeChangeConfirm = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            @click="showTypeChangeConfirm = false; void saveDraft(true)"
          >
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <!-- 删掉一个组是不可撤销的(而且组名可能已经被分流规则指着),和删订阅一样
         先确认一次,样式沿用同一个 DialogWrapper。 -->
    <DialogWrapper
      v-model="showDeleteDialog"
      :title="$t('groupDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('groupDeleteConfirm', { name: pendingDelete?.name || '' }) }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showDeleteDialog = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            :disabled="deleting"
            @click="confirmDelete"
          >
            <span
              v-if="deleting"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <!-- 自动分组:按国家批量建组。手工建的话,一个国家要点开弹窗、挑规则、写关键词、
         选图标,十个国家就是十遍——而这些信息国家目录里全都有。 -->
    <DialogWrapper
      v-model="showAuto"
      :title="$t('groupAutoTitle')"
      box-class="w-full max-w-xl"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupAutoTypesLabel') }}</label>
          <div class="flex items-center gap-4">
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                v-model="autoTypes"
                type="checkbox"
                value="urltest"
                class="checkbox checkbox-sm"
              />
              {{ $t('groupType_urltest') }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                v-model="autoTypes"
                type="checkbox"
                value="selector"
                class="checkbox checkbox-sm"
              />
              {{ $t('groupType_selector') }}
            </label>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <label class="text-xs font-medium">{{ $t('groupAutoCountriesLabel') }}</label>
            <!-- 用下拉框往里加,而不是把几十个国家铺成一列勾选框:常用的那几个已经
                 默认摆好了,剩下的按需搜索添加。 -->
            <div class="ml-auto w-36">
              <CountrySelect
                model-value=""
                :only="addableCountries"
                :placeholder="$t('groupAutoAddCountry')"
                @update:model-value="addAutoCountry"
              />
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="!autoCountries.length"
              @click="autoCountries = []"
            >
              {{ $t('groupSelectNone') }}
            </button>
          </div>
          <div class="border-base-content/10 max-h-64 overflow-y-auto rounded-lg border">
            <p
              v-if="!autoCountries.length"
              class="text-base-content/50 p-4 text-center text-xs"
            >
              {{ $t('groupAutoEmpty') }}
            </p>
            <Draggable
              v-model="autoCountries"
              :animation="150"
              :force-fallback="true"
              :fallback-on-body="true"
              handle=".drag-handle"
              ghost-class="opacity-40"
              item-key="self"
            >
              <template #item="{ element: code }">
              <div
                v-if="autoRow(code)"
                class="flex items-center gap-2 px-3 py-1.5 text-sm"
              >
                <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
                <CountryFlag
                  :code="code"
                  :size="16"
                />
                <span class="truncate">{{ autoRow(code)?.label }}</span>
                <!-- 当前节点数只是参考:0 也照样能建,动态组等的就是以后会有的节点 -->
                <span class="text-base-content/50 ml-auto text-xs whitespace-nowrap">
                  {{ $t('groupAutoNodeCount', { count: autoRow(code)?.count ?? 0 }) }}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-xs shrink-0"
                  :aria-label="$t('subscriptionRenameRemoveRow')"
                  @click="autoCountries = autoCountries.filter((x) => x !== code)"
                >
                  <XMarkIcon class="h-3.5 w-3.5" />
                </button>
              </div>
              </template>
            </Draggable>
          </div>
        </div>

        <p class="text-base-content/50 text-xs">{{ $t('groupAutoHint') }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showAuto = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="autoSaving || !autoCountries.length || !autoTypes.length"
            @click="createAutoGroups"
          >
            <span
              v-if="autoSaving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('groupAutoCreate', { count: autoCountries.length * autoTypes.length }) }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxFailoverLane, OpenboxFailoverSettings, OpenboxGroupType, OpenboxUserGroup } from '@/api/openbox'
import { fetchNodeGroups, saveNodeGroups } from '@/api/openbox'
import BulkPick from '@/components/subscription/BulkPick.vue'
import CountryFlag from '@/components/common/CountryFlag.vue'
import CountrySelect from '@/components/common/CountrySelect.vue'
import { kernelTestUrl } from '@/helper/testUrl'
import IconScaleInput from '@/components/common/IconScaleInput.vue'
import { AUTO_GROUP_DEFAULT_COUNTRIES, COUNTRIES, countryName, findCountry } from '@/constant/countries'
import { keywordMatches, normalizeForMatch } from '@/helper/keywordMatch'
import { showNotification } from '@/helper/notification'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import Draggable from 'vuedraggable'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const groups = ref<OpenboxUserGroup[]>([])
const availableNodes = ref<Array<{ name: string; subscription: string }>>([])
const loading = ref(false)
// 提示一律走右上角那套 toast(zashboard 自带的 showNotification),不在页面里挂
// 内联文字:内联的会把列表往下顶、切走再回来还在,而且同一屏里两种提示样式看着
// 像两套东西。
// content 传 i18n 键,params 交给 t();传原始错误串也行(t 找不到键就原样返回),
// api/index.ts 里报网络错误就是这么干的。
const notifyError = (err: unknown) =>
  showNotification({
    content: err instanceof Error ? err.message : String(err),
    type: 'alert-error',
  })

// 服务端把「按当前节点跑一遍」的结果一并返回:落地不了的组必须说出来。成员是按
// 名字引用的,节点一改名引用就会悬空,组会被静默丢掉——不提示的话,用户只会发现
// 配置里少了个组,却不知道为什么。同一个原因的合成一条,免得建十个空组刷十行。
const reportDropped = (list: Array<{ name: string; reason: string }>) => {
  const empty = list.filter((d) => d.reason !== 'cycle').map((d) => d.name)
  const cycle = list.filter((d) => d.reason === 'cycle').map((d) => d.name)
  if (empty.length) {
    showNotification({ content: 'groupDroppedEmpty', params: { names: empty.join('、') } })
  }
  if (cycle.length) {
    showNotification({ content: 'groupDroppedCycle', params: { names: cycle.join('、') } })
  }
}

const load = async () => {
  loading.value = true
  try {
    const data = await fetchNodeGroups()
    groups.value = data.groups
    availableNodes.value = data.availableNodes
  } catch (err) {
    notifyError(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 动态组报"按当前节点算出来是几个",静态组报名单里有几个。动态组的数字会随订阅
// 变化,这正是它的意义所在,所以列表里就该显示算出来的那个数,而不是关键词条数。
const matchedNodes = (group: OpenboxUserGroup) => {
  const keywords = group.keywords || []
  const names = availableNodes.value.map((n) => n.name)
  if (!keywords.length) return names
  return names.filter((name) => {
    const lower = normalizeForMatch(name)
    return keywords.some((kw) => keywordMatches(lower, kw))
  })
}

const memberSummary = (group: OpenboxUserGroup) => {
  if (group.type === 'failover') {
    const lanes = group.lanes || []
    const nodes = new Set(lanes.flatMap((l) => l.members))
    return t('failoverSummary', { lanes: lanes.length, count: nodes.size })
  }
  return group.mode === 'dynamic'
    ? t('groupDynamicSummary', { count: matchedNodes(group).length })
    : t('groupMembersSummary', { count: group.members.length })
}

const showEditor = ref(false)
const editing = ref<OpenboxUserGroup | null>(null)
const draft = ref<OpenboxUserGroup | null>(null)
const memberFilter = ref('')
const selectedFilter = ref('')
// 两栏各自的订阅下拉框,'' = 全部
const memberSub = ref('')
const selectedSub = ref('')
// 两栏各自的勾选状态(按名字记)。勾选 ≠ 成员:勾只表示"这条要不要被箭头搬走"。
const checkedAvailable = ref<string[]>([])
const checkedSelected = ref<string[]>([])
const saving = ref(false)

const openEditor = (group: OpenboxUserGroup | null) => {
  editing.value = group
  // 深拷贝:直接编辑列表里的对象会让"取消"也留下改动
  // 新建默认静态组:新建一个组多半是为了挑几个特定节点,默认成"不带关键词的动态组"
  // 等于一上来就把全部节点圈进去,不是人想要的。
  draft.value = group
    ? JSON.parse(JSON.stringify(group))
    : {
        id: '',
        name: '',
        type: 'urltest',
        mode: 'static',
        icon: '',
        keywords: [],
        members: [],
        interval: '5m',
        tolerance: 100,
        testUrl: '',
      }
  // 老记录可能没有这几个字段(服务端读的时候会补,但这里编辑的是本地副本)
  if (draft.value) {
    if (!draft.value.mode) draft.value.mode = 'static'
    if (!draft.value.keywords) draft.value.keywords = []
    if (draft.value.icon === undefined) draft.value.icon = ''
    if (draft.value.type === 'failover') ensureFailoverFields(draft.value)
  }
  lastType.value = draft.value?.type ?? 'urltest'
  normalBackup = null
  failoverBackup = null
  blockedMembers.value = []
  showAdvanced.value = false
  activeLaneId.value = draft.value?.lanes?.[0]?.id ?? ''
  memberFilter.value = ''
  selectedFilter.value = ''
  memberSub.value = ''
  selectedSub.value = ''
  checkedAvailable.value = []
  checkedSelected.value = []
  showEditor.value = true
}

// ---------- 故障转移(主备页签) ----------
const isFailover = computed(() => draft.value?.type === 'failover')
const FAILOVER_DEFAULTS: OpenboxFailoverSettings = { timeoutMs: 5000, failureThreshold: 2, restorePrimary: true, recoveryHoldMs: 60000 }
// 主备页签上限,和服务端 engine/user-groups.mjs 的 FAILOVER_MAX_LANES 同一个数
const FAILOVER_MAX_LANES = 3
const newLaneId = () => `lane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const makeLane = (members: string[] = []): OpenboxFailoverLane => ({ id: newLaneId(), name: '', icon: '', members })
// 故障转移草稿必须有的字段:页签(默认「主用」「备用 1」两个)、按秒的检测间隔、容差、高级参数
const ensureFailoverFields = (d: OpenboxUserGroup) => {
  d.mode = 'static'
  if (!d.lanes || !d.lanes.length) d.lanes = [makeLane(), makeLane()]
  for (const lane of d.lanes) if (lane.icon === undefined) lane.icon = ''
  if (!d.interval || !/^\d+s$/.test(d.interval)) d.interval = '30s'
  if (typeof d.tolerance !== 'number') d.tolerance = 100
  if (d.testUrl === undefined) d.testUrl = ''
  d.failover = { ...FAILOVER_DEFAULTS, ...(d.failover || {}) }
}
const failoverSettings = computed(() => (draft.value?.type === 'failover' ? draft.value.failover ?? null : null))
const showAdvanced = ref(false)
const activeLaneId = ref('')
const activeLane = computed(() => draft.value?.lanes?.find((l) => l.id === activeLaneId.value) ?? null)
const nodeNameSet = computed(() => new Set(availableNodes.value.map((n) => n.name)))
const validCount = (lane: OpenboxFailoverLane) => lane.members.filter((m) => nodeNameSet.value.has(m)).length
const laneRoleLabel = (index: number) => (index === 0 ? t('failoverPrimary') : t('failoverBackupN', { n: index }))
const laneLabelOf = (lane: OpenboxFailoverLane) => {
  const index = draft.value?.lanes?.findIndex((l) => l.id === lane.id) ?? 0
  const role = laneRoleLabel(Math.max(0, index))
  return lane.name ? `${role} · ${lane.name}` : role
}
// 页签全是单节点(或空)时容差没有用武之地:容差只给多节点页签的内部自动择优用
const allLanesSingle = computed(() => (draft.value?.lanes ?? []).every((l) => validCount(l) <= 1))
// 切换页签时清掉两栏的勾选:上一个页签勾的东西不能误搬到下一个
const selectLane = (id: string) => {
  if (activeLaneId.value === id) return
  activeLaneId.value = id
  checkedAvailable.value = []
  checkedSelected.value = []
}
const addLane = () => {
  if (!draft.value?.lanes || draft.value.lanes.length >= FAILOVER_MAX_LANES) return
  const lane = makeLane()
  draft.value.lanes = [...draft.value.lanes, lane]
  selectLane(lane.id)
}
// 当前页签的图标:没单独挑就显示(并继承)分组的图标;挑成和分组一样的就存空,继续跟着分组走
const activeLaneIcon = computed<string>({
  get: () => activeLane.value?.icon || draft.value?.icon || '',
  set: (v: string) => {
    if (!activeLane.value) return
    activeLane.value.icon = v && v !== (draft.value?.icon || '') ? v : ''
  },
})
const showLaneDelete = ref(false)
const pendingLane = ref<OpenboxFailoverLane | null>(null)
const deleteLane = (id: string) => {
  const lanes = draft.value?.lanes
  if (!lanes) return
  const i = lanes.findIndex((l) => l.id === id)
  const next = lanes.filter((l) => l.id !== id)
  draft.value!.lanes = next
  if (activeLaneId.value === id) {
    const neighbour = next[Math.min(Math.max(0, i), next.length - 1)]
    activeLaneId.value = neighbour?.id ?? ''
    checkedAvailable.value = []
    checkedSelected.value = []
  }
}
const askDeleteLane = (lane: OpenboxFailoverLane) => {
  if (!lane.members.length) {
    deleteLane(lane.id)
    return
  }
  pendingLane.value = lane
  showLaneDelete.value = true
}
const confirmDeleteLane = () => {
  if (pendingLane.value) deleteLane(pendingLane.value.id)
  pendingLane.value = null
  showLaneDelete.value = false
}
// 界面上按秒填,存的是 sing-box 认的 "30s"
const intervalSeconds = computed<number>({
  get: () => {
    const m = /^(\d+)s$/.exec(draft.value?.interval || '')
    return m ? Number(m[1]) : 30
  },
  set: (v: number) => {
    if (!draft.value) return
    const n = Number.isFinite(v) ? Math.min(86400, Math.max(5, Math.floor(v))) : 30
    draft.value.interval = `${n}s`
  },
})
const timeoutSeconds = computed<number>({
  get: () => Math.round((failoverSettings.value?.timeoutMs ?? 5000) / 1000),
  set: (v: number) => {
    if (!failoverSettings.value) return
    failoverSettings.value.timeoutMs = (Number.isFinite(v) ? Math.min(60, Math.max(1, Math.floor(v))) : 5) * 1000
  },
})
const recoveryHoldSeconds = computed<number>({
  get: () => Math.round((failoverSettings.value?.recoveryHoldMs ?? 60000) / 1000),
  set: (v: number) => {
    if (!failoverSettings.value) return
    failoverSettings.value.recoveryHoldMs = (Number.isFinite(v) ? Math.min(86400, Math.max(0, Math.floor(v))) : 60) * 1000
  },
})

// 类型切换:普通 ↔ 故障转移之间成员形状不同,两边各留一份草稿便于切回;组成员进不了页签的列出来拦住保存
const lastType = ref<OpenboxGroupType>('urltest')
const blockedMembers = ref<string[]>([])
let normalBackup: { mode: OpenboxUserGroup['mode']; members: string[]; keywords: string[]; interval?: string } | null = null
let failoverBackup: { lanes: OpenboxFailoverLane[] } | null = null
const onTypeChange = () => {
  const d = draft.value
  if (!d) return
  const prev = lastType.value
  const next = d.type
  lastType.value = next
  if (prev === next) return
  if (next === 'failover') {
    normalBackup = { mode: d.mode, members: [...d.members], keywords: [...(d.keywords || [])], interval: d.interval }
    if (failoverBackup) {
      d.lanes = failoverBackup.lanes.map((l) => ({ ...l, members: [...l.members] }))
    } else {
      // 已有的真实节点放进主用页签;引用了组的成员不能悄悄展开或丢掉,列出来等用户处理;
      // 只有动态规则的组进入空草稿,不自动取全量节点
      const nodes = d.mode === 'static' ? d.members.filter((m) => nodeNameSet.value.has(m)) : []
      blockedMembers.value = d.mode === 'static' ? d.members.filter((m) => !nodeNameSet.value.has(m)) : []
      d.lanes = [makeLane(nodes), makeLane()]
    }
    d.members = []
    d.interval = ''
    ensureFailoverFields(d)
    activeLaneId.value = d.lanes?.[0]?.id ?? ''
  } else if (prev === 'failover') {
    failoverBackup = { lanes: (d.lanes ?? []).map((l) => ({ ...l, members: [...l.members] })) }
    blockedMembers.value = []
    d.mode = normalBackup?.mode ?? 'static'
    d.members = normalBackup ? [...normalBackup.members] : []
    d.keywords = normalBackup ? [...normalBackup.keywords] : []
    d.interval = normalBackup?.interval && /^\d+m$/.test(normalBackup.interval) ? normalBackup.interval : '5m'
    if (typeof d.tolerance !== 'number') d.tolerance = 100
  }
  checkedAvailable.value = []
  checkedSelected.value = []
}

// 穿梭框操作的成员表:故障转移是当前页签的成员,普通组是 draft.members
const members = computed<string[]>({
  get: () => (isFailover.value ? activeLane.value?.members ?? [] : draft.value?.members ?? []),
  set: (list: string[]) => {
    if (isFailover.value) {
      if (activeLane.value) activeLane.value.members = list
    } else if (draft.value) {
      draft.value.members = list
    }
  },
})

// 候选成员 = 所有节点 + 除自己以外的其它组(组可以套组,但不能套自己)。
// 故障转移的页签只放真实节点:候选里没有组、站点集、内置出站或别的故障转移组
const candidates = computed(() => {
  const nodeItems = availableNodes.value.map((n) => ({
    kind: 'node' as const, name: n.name, subscription: n.subscription,
  }))
  if (isFailover.value) return nodeItems
  const groupItems = groups.value
    .filter((g) => g.name !== draft.value?.name)
    .map((g) => ({ kind: 'group' as const, name: g.name, subscription: '' }))
  return [...groupItems, ...nodeItems]
})

// 订阅下拉框的选项:节点实际来自的订阅,去重后按出现顺序排。空字符串(来源未知的
// 老节点)不进下拉框——给一个选不出东西的选项没有意义。
const subscriptionOptions = computed(() => {
  const seen: string[] = []
  for (const n of availableNodes.value) {
    if (n.subscription && !seen.includes(n.subscription)) seen.push(n.subscription)
  }
  return seen
})

// 一栏的"作用范围" = 该栏下拉框 + 过滤框共同框定的候选集。三个批量按钮就按这个
// 范围来:下拉框选中某条订阅、再按「全选」,勾中的正好是那条订阅的节点——这也是
// 加这个下拉框的用处。两个都不设时,范围就是整份候选集。
// 下拉框的值:'' 全部 / 'kind:group' 全部节点组 / 'kind:node' 全部节点 /
// 'sub:<订阅名>' 单条订阅(前缀见 BulkPick.vue 里的说明)。
const scopeOf = (sel: string, keyword: string) => {
  const kw = keyword.trim().toLowerCase()
  const matchKind = (item: { kind: string; subscription: string }) => {
    if (!sel) return true
    if (sel === 'kind:group') return item.kind === 'group'
    if (sel === 'kind:node') return item.kind === 'node'
    if (sel.startsWith('sub:')) return item.subscription === sel.slice(4)
    return true
  }
  return candidates.value.filter(
    (item) => matchKind(item) && (!kw || item.name.toLowerCase().includes(kw)),
  )
}

// 左侧只列"还没选的":选走一个左边就少一个,不必再靠打勾去分辨状态。
// 故障转移按当前页签算:同一节点可以出现在不同页签,同一页签内不重复
const availableCandidates = computed(() =>
  candidates.value.filter((item) => !members.value.includes(item.name)),
)

const filteredAvailable = computed(() => {
  const inScope = new Set(scopeOf(memberSub.value, memberFilter.value).map((c) => c.name))
  return availableCandidates.value.filter((item) => inScope.has(item.name))
})

const addMember = (name: string) => {
  if (!draft.value || members.value.includes(name)) return
  members.value = [...members.value, name]
  checkedAvailable.value = checkedAvailable.value.filter((n) => n !== name)
}

const removeMember = (name: string) => {
  if (!draft.value) return
  members.value = members.value.filter((m) => m !== name)
  checkedSelected.value = checkedSelected.value.filter((n) => n !== name)
}

// 界面上填的是分钟数,存进去仍是 sing-box 认的 "3m" 形式。原来直接让用户手写
// "3m" 这种带单位的字符串:写成 "3" 或 "3分钟" 都会被内核当成非法值,而界面上看不出
// 哪种写法才对。
const intervalMinutes = computed<number>({
  get: () => {
    const m = /^(\d+)/.exec(draft.value?.interval || '')
    return m ? Number(m[1]) : 3
  },
  set: (v: number) => {
    if (!draft.value) return
    const n = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
    draft.value.interval = `${n}m`
  },
})

const filteredSelected = computed(() => {
  const list = members.value
  const inScope = new Set(scopeOf(selectedSub.value, selectedFilter.value).map((c) => c.name))
  // 故障转移里已经失效的引用(订阅更新删掉的节点)不在候选表里,过滤 / 订阅筛选为空时照样列出来给用户看
  if (isFailover.value && !selectedSub.value && !selectedFilter.value.trim()) return list
  return list.filter((name) => inScope.has(name))
})

// 三个批量动作改的是**勾选状态**,不是成员归属:成员归属由"在左边还是右边"表示,
// 勾选只回答"这条要不要被箭头搬走"。作用范围是按下它的那一栏**当前列出来的那些**
// (下拉框 + 过滤框筛过之后),所见即所动;栏外、被筛掉的一条都不动。
type Pane = 'available' | 'selected'
const visibleOf = (pane: Pane) =>
  pane === 'available' ? filteredAvailable.value.map((i) => i.name) : filteredSelected.value
const checkedOf = (pane: Pane) => (pane === 'available' ? checkedAvailable : checkedSelected)

const tickAll = (pane: Pane) => {
  const box = checkedOf(pane)
  box.value = [...new Set([...box.value, ...visibleOf(pane)])]
}
const tickNone = (pane: Pane) => {
  const box = checkedOf(pane)
  const visible = new Set(visibleOf(pane))
  box.value = box.value.filter((n) => !visible.has(n))
}
const tickInvert = (pane: Pane) => {
  const box = checkedOf(pane)
  const ticked = new Set(box.value)
  const visible = visibleOf(pane)
  const add = visible.filter((n) => !ticked.has(n))
  const remove = new Set(visible.filter((n) => ticked.has(n)))
  box.value = [...box.value.filter((n) => !remove.has(n)), ...add]
}

// 两个箭头:把勾中的整批搬到另一边,搬完清掉这一侧的勾(它们已经不在这一栏了)
const moveRight = () => {
  if (!draft.value) return
  const chosen = new Set(members.value)
  members.value = [
    ...members.value,
    ...checkedAvailable.value.filter((n) => !chosen.has(n)),
  ]
  checkedAvailable.value = []
}
const moveLeft = () => {
  if (!draft.value) return
  const drop = new Set(checkedSelected.value)
  members.value = members.value.filter((n) => !drop.has(n))
  checkedSelected.value = []
}

// 关键词在界面上是一行逗号分隔的文本,存下去是数组
const keywordsText = computed({
  get: () => (draft.value?.keywords || []).join(','),
  set: (v: string) => {
    if (!draft.value) return
    draft.value.keywords = v
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  },
})

// 按当前节点实时算一遍:关键词写完能立刻看到会选中谁,不用保存了再回来看
const dynamicMatched = computed(() => (draft.value ? matchedNodes(draft.value) : []))

// ---------- 自动分组 ----------
const showAuto = ref(false)
const autoTypes = ref<OpenboxGroupType[]>(['urltest'])
const autoCountries = ref<string[]>([])
const autoSaving = ref(false)

// 每个已选国家当前命中几个节点(只是参考,0 也能建)。列表顺序由 autoCountries
// 本身决定——它就是拖拽排序的那个数组,所以不能再套一层 computed 去重排。
const autoNodeCount = computed(() => {
  const names = availableNodes.value.map((n) => normalizeForMatch(n.name))
  const out: Record<string, number> = {}
  for (const c of COUNTRIES) {
    out[c.code] = names.filter((n) => c.keywords.some((kw) => keywordMatches(n, kw))).length
  }
  return out
})

const autoRow = (code: string) => {
  const c = findCountry(code)
  if (!c) return null
  return { code: c.code, label: countryName(c, locale.value), count: autoNodeCount.value[c.code] ?? 0 }
}

// 下拉框里只给"当前节点里真有的国家",并且已经加过的不再出现:选了也没用的选项
// 不该摆在那儿。按节点数从多到少排,常用的在最上面。
const addableCountries = computed(() => {
  const counts = autoNodeCount.value
  return COUNTRIES.map((c) => c.code)
    .filter((code) => (counts[code] ?? 0) > 0 && !autoCountries.value.includes(code))
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
})

const addAutoCountry = (code: string) => {
  if (!code || autoCountries.value.includes(code)) return
  autoCountries.value = [...autoCountries.value, code]
}

const openAutoDialog = () => {
  autoTypes.value = ['urltest']
  autoCountries.value = [...AUTO_GROUP_DEFAULT_COUNTRIES]
  showAuto.value = true
}

const AUTO_SUFFIX: Record<OpenboxGroupType, string> = {
  urltest: '自动',
  selector: '手动',
  // 自动分组只建自动 / 手动两种;故障转移要用户自己排主备,这里只是让类型表完整
  failover: '主备',
}

// 同一个国家的组要挨在一起,自动排在手动前面。分两次生成(先建一批自动,过几天
// 再补手动)的话,新的会被追加到末尾,同一个国家就被拆到列表的两头了。
// 认国家靠 icon 里的两位国家代码——自动分组生成时一定会写上它。
const TYPE_ORDER: Record<string, number> = { urltest: 0, selector: 1 }
const countryOf = (g: OpenboxUserGroup) =>
  g.icon && /^[A-Za-z]{2}$/.test(g.icon) ? g.icon.toUpperCase() : ''

// 把这次涉及到的国家整理成块:同国家的(已有的 + 新建的)聚到一起,放在该国家
// 第一个已有组的位置上;没有已有组的国家整块追加到末尾。不碰其它国家的顺序——
// 用户可能是自己拖成那样的。
const mergeByCountry = (current: OpenboxUserGroup[], added: OpenboxUserGroup[]) => {
  const codes = [...new Set(added.map(countryOf).filter(Boolean))]
  const byType = (a: OpenboxUserGroup, b: OpenboxUserGroup) =>
    (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)

  let out = [...current]
  for (const code of codes) {
    const mine = [...out.filter((g) => countryOf(g) === code), ...added.filter((g) => countryOf(g) === code)]
    mine.sort(byType)
    const anchor = out.findIndex((g) => countryOf(g) === code)
    out = out.filter((g) => countryOf(g) !== code)
    out.splice(anchor === -1 ? out.length : anchor, 0, ...mine)
  }
  // 认不出国家的(比如图标被改成地球)照旧追加到末尾
  return [...out, ...added.filter((g) => !countryOf(g))]
}

const createAutoGroups = async () => {
  if (autoSaving.value) return
  const existing = new Set(groups.value.map((g) => g.name))
  const next: OpenboxUserGroup[] = []
  let skipped = 0
  for (const code of autoCountries.value) {
    const country = findCountry(code)
    if (!country) continue
    for (const type of autoTypes.value) {
      const name = `${countryName(country, locale.value)}-${AUTO_SUFFIX[type]}`
      // 同名的跳过:组名就是内核里的出站名,重名会生成两个同名出站
      if (existing.has(name)) {
        skipped += 1
        continue
      }
      existing.add(name)
      next.push({
        id: `auto-${code.toLowerCase()}-${type}-${Date.now()}-${next.length}`,
        name,
        type,
        mode: 'dynamic',
        icon: code,
        // 关键词直接用国家目录里的那份,和地区词典是同一套词
        keywords: [...country.keywords],
        members: [],
        ...(type === 'urltest' ? { interval: '5m', tolerance: 100 } : {}),
      })
    }
  }

  if (!next.length) {
    showNotification({ content: 'groupAutoAllExist', type: 'alert-error' })
    return
  }

  autoSaving.value = true
  try {
    await persist(mergeByCountry(groups.value, next))
    showAuto.value = false
    if (skipped) {
      showNotification({
        content: 'groupAutoSkipped',
        params: { count: String(skipped) },
        type: 'alert-info',
      })
    }
  } catch (err) {
    notifyError(err)
  } finally {
    autoSaving.value = false
  }
}

// 两个入口都在父组件的页签行上,弹窗在这里,所以要把它们暴露出去
defineExpose({ openEditor, openAutoDialog })

// 拖完就存:顺序也是配置的一部分(策略组在内核里的排列),不存下来刷新就白拖了
const persistOrder = async () => {
  try {
    await persist([...groups.value])
  } catch (err) {
    notifyError(err)
  }
}

const persist = async (next: OpenboxUserGroup[]) => {
  const res = await saveNodeGroups(next)
  groups.value = res.groups
  reportDropped(res.dropped || [])
  // 悬空引用:组没空的话 dropped 不会提到它,单独说
  for (const d of res.dangling || []) {
    showNotification({ content: 'groupDanglingMembers', params: { group: d.name, members: d.members.join('、') }, type: 'alert-warning' })
  }
  return res
}

const showTypeChangeConfirm = ref(false)
const saveDraft = async (typeChangeConfirmed = false) => {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) {
    showNotification({ content: 'groupNameRequired', type: 'alert-error' })
    return
  }
  // 组名就是 sing-box 的出站 tag,重名会生成两个同名出站——在这里就拦住,别等部署时才炸
  if (groups.value.some((g) => g.name === name && g.id !== draft.value?.id)) {
    showNotification({ content: 'groupNameDuplicate', type: 'alert-error' })
    return
  }
  if (isFailover.value) {
    // 从普通组带过来的组成员还没处理:不能悄悄丢
    if (blockedMembers.value.length) {
      showNotification({ content: 'failoverBlockedMembersRequired', type: 'alert-error' })
      return
    }
    const lanes = draft.value.lanes ?? []
    const nonEmpty = lanes.filter((l) => validCount(l) > 0).length
    // 新建至少两个非空候选(只有一个候选就不是故障转移);已保存的组允许历史失效后只剩一个,
    // 但不能一个都没有
    if ((editing.value ? nonEmpty < 1 : nonEmpty < 2)) {
      showNotification({ content: editing.value ? 'failoverLanesRequiredOne' : 'failoverLanesRequired', type: 'alert-error' })
      return
    }
  } else if (draft.value.mode === 'static' && !draft.value.members.length) {
    // 动态组不需要成员名单:关键词为空就是"全部节点",本身是合法的一种组
    showNotification({ content: 'groupMembersRequired', type: 'alert-error' })
    return
  }
  // 已保存的故障转移组改成普通类型:主备层次会丢,先确认
  if (!isFailover.value && editing.value?.type === 'failover' && !typeChangeConfirmed) {
    showTypeChangeConfirm.value = true
    return
  }

  saving.value = true
  try {
    // 组自己的测速地址 http:// 升成 https://(内核的延迟测试不认 http,见 helper/testUrl.ts)
    const base: OpenboxUserGroup = { ...draft.value, name, id: draft.value.id || `g-${Date.now()}`, testUrl: kernelTestUrl(draft.value.testUrl) }
    let item: OpenboxUserGroup
    if (isFailover.value) {
      // 页签是唯一的成员来源:members / keywords 清空;页签名去掉首尾空白
      item = {
        ...base, mode: 'static', members: [], keywords: [],
        lanes: (base.lanes ?? []).map((l) => ({ id: l.id, name: l.name.trim(), icon: l.icon || '', members: [...l.members] })),
        failover: { ...FAILOVER_DEFAULTS, ...(base.failover || {}) },
      }
    } else {
      const { lanes: _lanes, failover: _failover, ...rest } = base
      void _lanes
      void _failover
      item = rest
    }
    const next = editing.value
      ? groups.value.map((g) => (g.id === editing.value?.id ? item : g))
      : [...groups.value, item]
    await persist(next)
    showEditor.value = false
  } catch (err) {
    notifyError(err)
  } finally {
    saving.value = false
  }
}

// ---- 启用/停用 ----
const toggling = ref<string | null>(null)
const toggleEnabled = async (group: OpenboxUserGroup) => {
  if (toggling.value) return
  toggling.value = group.id
  try {
    await persist(groups.value.map((g) => (g.id === group.id ? { ...g, enabled: g.enabled === false } : g)))
  } catch (err) {
    notifyError(err)
  } finally {
    toggling.value = null
  }
}

// ---- 内置出站:只改名字、图标和图标缩放 ----
const showBuiltinEditor = ref(false)
const builtinDraft = ref<OpenboxUserGroup | null>(null)
const openBuiltinEditor = (group: OpenboxUserGroup) => {
  builtinDraft.value = JSON.parse(JSON.stringify(group))
  showBuiltinEditor.value = true
}
const saveBuiltin = async () => {
  const d = builtinDraft.value
  if (!d || saving.value) return
  const name = d.name.trim()
  if (!name) {
    showNotification({ content: 'groupNameRequired', type: 'alert-error' })
    return
  }
  // 名字就是内核里的出站 tag,和别的组重名同样不行
  if (groups.value.some((g) => g.name === name && g.id !== d.id)) {
    showNotification({ content: 'groupNameDuplicate', type: 'alert-error' })
    return
  }
  saving.value = true
  try {
    await persist(groups.value.map((g) => (g.id === d.id ? { ...g, name, icon: d.icon, iconScale: d.iconScale || 0 } : g)))
    showBuiltinEditor.value = false
  } catch (err) {
    notifyError(err)
  } finally {
    saving.value = false
  }
}

const showDeleteDialog = ref(false)
const pendingDelete = ref<OpenboxUserGroup | null>(null)
const deleting = ref(false)

const askDelete = (group: OpenboxUserGroup) => {
  pendingDelete.value = group
  showDeleteDialog.value = true
}

const confirmDelete = async () => {
  const group = pendingDelete.value
  if (!group || deleting.value) return
  deleting.value = true
  try {
    await persist(groups.value.filter((g) => g.id !== group.id))
    showDeleteDialog.value = false
    pendingDelete.value = null
  } catch (err) {
    notifyError(err)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
/* 提醒句用淡黄底 + 正常文字色(和规则页的 .route-note 同一套),不用黄字——浅色主题上黄字看不清 */
.fo-note {
  border-left: 2px solid var(--color-warning);
  background-color: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: color-mix(in srgb, var(--color-base-content) 85%, transparent);
}
</style>
