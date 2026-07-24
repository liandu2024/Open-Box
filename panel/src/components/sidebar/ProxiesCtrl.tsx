import { disconnectByIdAPI, isSingBox, updateProxyProviderAPI } from '@/api'
import {
  domainGroups,
  domainGroupSearch,
  domainGroupSelectedName,
  domainRuleConfigChanged,
  domainRulesReloadRevision,
  nodeGroups,
  policyGroups,
  renderGroups,
} from '@/composables/proxies'
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { PROXY_SORT_TYPE, PROXY_TAB_TYPE, ROUTE_NAME, SETTINGS_MENU_KEY } from '@/constant'
import { getProxyNodeProtocolDescription, isPassRuleProxy, isProxyGroup } from '@/helper'
import { showNotification } from '@/helper/notification'
import {
  buildProxyCategoryGroups,
  getProxyCategoryCollapseKey,
  isProxyCategoryEnabled,
} from '@/helper/proxyCategory'
import {
  DOMAIN_GROUP_POST_CUSTOM_KEY,
  DOMAIN_GROUP_PRE_CUSTOM_KEY,
  isDomainGroupCustomKey,
} from '@/helper/proxyDomainGroups'
import { getMinCardWidth } from '@/helper/utils'
import { fetchServerApi } from '@/store/auth'
import { configs, updateConfigs } from '@/store/config'
import { activeConnections } from '@/store/connections'
import {
  allProxiesLatencyTest,
  fetchProxies,
  getIPv6ByName,
  getNowProxyNodeName,
  getTestUrl,
  hasSmartGroup,
  proxiesFilter,
  proxiesTabShow,
  proxyLatencyTest,
  proxyMap,
  proxyNodesLatencyTest,
  proxyProviederList,
} from '@/store/proxies'
import { fetchRules } from '@/store/rules'
import {
  automaticDisconnection,
  collapseGroupMap,
  displayFinalOutbound,
  groupProxiesByProvider,
  hideUnavailableProxies,
  IPv6test,
  manageHiddenGroup,
  minProxyCardWidth,
  providerProxyCategoryCollapseMap,
  providerProxyCategoryEnabledMap,
  providerProxyCategoryFeatureEnabled,
  providerProxyCategoryWildcardMap,
  proxyCardSize,
  proxySortType,
  twoColumnProxyGroup,
  useSmartGroupSort,
} from '@/store/settings'
import {
  ArrowPathIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'
import { every } from 'lodash'
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'
import LatencyTag from '../proxies/LatencyTag.vue'

export default defineComponent({
  name: 'ProxiesCtrl',
  setup() {
    type GlobalCollapseTarget =
      | {
          type: 'group'
          key: string
        }
      | {
          type: 'provider-category'
          key: string
        }

    const { t } = useI18n()
    const router = useRouter()
    const isUpgrading = ref(false)
    const isAllLatencyTesting = ref(false)
    const settingsModel = ref(false)
    const addDomainRuleModal = ref(false)
    const isAddingDomainRule = ref(false)
    const isRestartingProxy = ref(false)
    const customRuleParamSearch = ref('')
    const customRuleParamTab = ref<'group' | 'node'>('group')
    const isCustomRuleParamDropdownOpen = ref(false)
    const customRuleParamTesting = ref<Record<string, boolean>>({})
    const isCustomRuleParamTestingAll = ref(false)
    const domainRuleForm = ref({
      value: '',
      param: '',
      type: 'DOMAIN-SUFFIX',
    })
    const { isLargeCtrlsBar } = useCtrlsBar()

    const handlerClickUpdateAllProviders = async () => {
      if (isUpgrading.value) return
      isUpgrading.value = true
      try {
        await Promise.all(
          proxyProviederList.value.map((provider) => updateProxyProviderAPI(provider.name)),
        )
        await fetchProxies()
        isUpgrading.value = false
      } catch {
        await fetchProxies()
        isUpgrading.value = false
      }
    }

    const defaultModes = ['direct', 'rule', 'global']
    const modeList = computed(() => {
      return configs.value?.['mode-list'] || configs.value?.['modes'] || defaultModes
    })
    const needTranslateModes = computed(() => {
      return every(modeList.value, (mode) => defaultModes.includes(mode.toLowerCase()))
    })

    const handlerModeChange = (e: Event) => {
      const mode = (e.target as HTMLSelectElement).value
      updateConfigs({ mode })
      if (isSingBox.value && automaticDisconnection.value) {
        activeConnections.value.forEach((connection) => {
          if (connection.rule.includes('clash_mode')) {
            disconnectByIdAPI(connection.id)
          }
        })
      }
    }

    const handlerClickLatencyTestAll = async () => {
      if (isAllLatencyTesting.value) return
      isAllLatencyTesting.value = true
      try {
        await allProxiesLatencyTest()
        isAllLatencyTesting.value = false
      } catch {
        isAllLatencyTesting.value = false
      }
    }

    const selectedDomainGroupLabel = computed(() => {
      if (domainGroupSelectedName.value === DOMAIN_GROUP_PRE_CUSTOM_KEY) {
        return t('preCustom')
      }

      if (domainGroupSelectedName.value === DOMAIN_GROUP_POST_CUSTOM_KEY) {
        return t('postCustom')
      }

      return domainGroupSelectedName.value
    })

    const isSelectedCustomDomainGroup = computed(() =>
      isDomainGroupCustomKey(domainGroupSelectedName.value),
    )
    type CustomRuleParamOption = {
      name: string
      type: 'builtin' | 'group' | 'node'
      index: number
      searchable: string
      description?: string
    }
    type DomainRuleValidationError = {
      content: string
      params: Record<string, string>
    }
    const proxyDirectRuleTypes = [
      {
        value: 'DOMAIN-SUFFIX',
        label: t('ruleTypeDomainSuffix'),
      },
      {
        value: 'DOMAIN',
        label: t('ruleTypeDomain'),
      },
      {
        value: 'DOMAIN-KEYWORD',
        label: t('ruleTypeDomainKeyword'),
      },
      {
        value: 'IP-CIDR',
        label: t('ruleTypeDestinationIP'),
      },
      {
        value: 'IP-CIDR6',
        label: t('ruleTypeDestinationIPv6'),
      },
      {
        value: 'SRC-IP-CIDR',
        label: t('ruleTypeSourceIP'),
      },
      {
        value: 'SRC-IP-CIDR6',
        label: t('ruleTypeSourceIPv6'),
      },
    ]
    const proxyIpRuleTypeSet = new Set(['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR', 'SRC-IP-CIDR6'])
    const isIpDomainRuleType = computed(() => proxyIpRuleTypeSet.has(domainRuleForm.value.type))
    const domainRuleValuePlaceholder = computed(() => {
      if (domainRuleForm.value.type === 'IP-CIDR6') {
        return '2001:db8::/32'
      }

      if (domainRuleForm.value.type === 'SRC-IP-CIDR6') {
        return '2001:db8::1/128'
      }

      if (domainRuleForm.value.type === 'IP-CIDR') {
        return '8.8.8.8/32'
      }

      if (domainRuleForm.value.type === 'SRC-IP-CIDR') {
        return '192.168.1.10/32'
      }

      if (domainRuleForm.value.type === 'DOMAIN-KEYWORD') {
        return 'keyword'
      }

      return 'example.com'
    })
    const customRuleParamOptions = computed(() => {
      const options: CustomRuleParamOption[] = []
      const seen = new Set<string>()
      const append = (name: string, type: CustomRuleParamOption['type'], description?: string) => {
        const normalizedName = String(name || '').trim()

        if (!normalizedName || seen.has(normalizedName)) {
          return
        }

        seen.add(normalizedName)
        options.push({
          name: normalizedName,
          type,
          index: options.length,
          searchable: normalizedName.toLowerCase(),
          description,
        })
      }

      append('DIRECT', 'builtin')
      append('REJECT', 'builtin')
      nodeGroups.value.forEach((name) => append(name, 'group'))
      Object.values(proxyMap.value).forEach((proxy) => {
        if (proxy && !isPassRuleProxy(proxy) && !isProxyGroup(proxy.name)) {
          append(
            proxy.name,
            'node',
            getProxyNodeProtocolDescription(proxy, IPv6test.value && getIPv6ByName(proxy.name)),
          )
        }
      })

      return options
    })
    const filteredCustomRuleParamOptions = computed(() => {
      const keywords = customRuleParamSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
      const filteredOptions = keywords.length
        ? customRuleParamOptions.value.filter((option) =>
            keywords.every((keyword) => option.searchable.includes(keyword)),
          )
        : customRuleParamOptions.value

      const builtins =
        customRuleParamTab.value === 'node'
          ? filteredOptions.filter((option) => option.type === 'builtin')
          : []
      const selectableOptions = filteredOptions
        .filter((option) => option.type === customRuleParamTab.value)
        .sort((left, right) => left.index - right.index)

      return [...builtins, ...selectableOptions]
    })
    const selectedCustomRuleParamOption = computed(() =>
      customRuleParamOptions.value.find((option) => option.name === domainRuleForm.value.param),
    )
    const customRuleParamTestableOptions = computed(() =>
      filteredCustomRuleParamOptions.value.filter((option) => option.type !== 'builtin'),
    )
    const selectedCustomGroupMode = computed(() => {
      if (domainGroupSelectedName.value === DOMAIN_GROUP_PRE_CUSTOM_KEY) {
        return 'pre'
      }

      if (domainGroupSelectedName.value === DOMAIN_GROUP_POST_CUSTOM_KEY) {
        return 'post'
      }

      return ''
    })
    const canAddDomainRule = computed(
      () => isSelectedCustomDomainGroup.value && Boolean(selectedCustomGroupMode.value),
    )
    const getDomainRuleHostValue = (value: string) => {
      const normalizedValue = value.trim()

      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedValue)) {
        try {
          return new URL(normalizedValue).hostname.replace(/^\[(.*)\]$/, '$1')
        } catch {
          return normalizedValue
        }
      }

      return normalizedValue.replace(/^\*\./, '').replace(/^\[(.*)\]$/, '$1')
    }

    const isValidIpv4Address = (value: string) => {
      const parts = value.split('.')

      return (
        parts.length === 4 &&
        parts.every((part) => {
          if (!/^\d{1,3}$/.test(part)) {
            return false
          }

          const number = Number(part)

          return number >= 0 && number <= 255
        })
      )
    }

    const isValidIpv6Address = (value: string) => {
      const normalizedValue = value.toLowerCase()

      if (!normalizedValue.includes(':') || normalizedValue.includes(':::')) {
        return false
      }

      const compressionMatches = normalizedValue.match(/::/g) || []

      if (compressionMatches.length > 1) {
        return false
      }

      const hasCompression = compressionMatches.length === 1
      const [left = '', right = ''] = normalizedValue.split('::')
      const leftParts = left ? left.split(':') : []
      const rightParts = right ? right.split(':') : []
      const parts = [...leftParts, ...rightParts]

      if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
        return false
      }

      return hasCompression ? parts.length < 8 : parts.length === 8
    }

    const parseRuleIpCidr = (value: string) => {
      const normalizedValue = getDomainRuleHostValue(value)
      const parts = normalizedValue.split('/')

      if (parts.length > 2 || !parts[0]) {
        return null
      }

      const version = isValidIpv4Address(parts[0]) ? 4 : isValidIpv6Address(parts[0]) ? 6 : 0

      if (!version) {
        return null
      }

      if (parts.length === 1) {
        return { version }
      }

      if (!/^\d+$/.test(parts[1])) {
        return null
      }

      const prefix = Number(parts[1])
      const maxPrefix = version === 4 ? 32 : 128

      return prefix >= 0 && prefix <= maxPrefix ? { version } : null
    }

    const isValidDomainRuleHost = (value: string) => {
      const host = getDomainRuleHostValue(value).replace(/\.$/, '')

      if (!host || host.length > 253 || /[/\\:[\]]/.test(host)) {
        return false
      }

      return host.split('.').every((label) => {
        return (
          label.length > 0 &&
          label.length <= 63 &&
          /^[a-z0-9-]+$/i.test(label) &&
          !label.startsWith('-') &&
          !label.endsWith('-')
        )
      })
    }

    const validateDomainRuleForm = (): DomainRuleValidationError | null => {
      const value = domainRuleForm.value.value.trim()

      if (!value) {
        return {
          content: 'domainRuleInputRequired',
          params: {},
        }
      }

      if (/[\s,\r\n]/.test(value)) {
        return {
          content: 'domainRuleInputInvalidCharacters',
          params: {},
        }
      }

      const type = domainRuleForm.value.type
      const parsedIp = parseRuleIpCidr(value)

      if (proxyIpRuleTypeSet.has(type)) {
        if (!parsedIp) {
          return {
            content: 'domainRuleIpInvalid',
            params: {
              example: type.includes('6') ? '2001:db8::/32' : '192.168.1.0/24',
            },
          }
        }

        if (!type.includes('6') && parsedIp.version !== 4) {
          return {
            content: 'domainRuleIpVersionMismatch',
            params: {
              version: 'IPv4',
            },
          }
        }

        if (type.includes('6') && parsedIp.version !== 6) {
          return {
            content: 'domainRuleIpVersionMismatch',
            params: {
              version: 'IPv6',
            },
          }
        }

        return null
      }

      if (parsedIp) {
        return {
          content: 'domainRuleDomainCannotBeIp',
          params: {},
        }
      }

      if (type !== 'DOMAIN-KEYWORD' && !isValidDomainRuleHost(value)) {
        return {
          content: 'domainRuleDomainInvalid',
          params: {},
        }
      }

      return null
    }

    const openAddDomainRuleModal = () => {
      if (!canAddDomainRule.value) return
      domainRuleForm.value.param = ''
      customRuleParamSearch.value = ''
      customRuleParamTab.value = 'group'
      isCustomRuleParamDropdownOpen.value = false
      addDomainRuleModal.value = true
    }

    const selectCustomRuleParam = (name: string) => {
      domainRuleForm.value.param = name
      isCustomRuleParamDropdownOpen.value = false
    }

    const getCustomRuleParamLatencyTarget = (option: CustomRuleParamOption) =>
      option.type === 'group' ? getNowProxyNodeName(option.name) : option.name

    const getCustomRuleParamLatencyGroup = (option: CustomRuleParamOption) =>
      option.type === 'group' ? option.name : undefined

    const setCustomRuleParamTesting = (option: CustomRuleParamOption, testing: boolean) => {
      const key = `${option.type}:${option.name}`
      customRuleParamTesting.value = {
        ...customRuleParamTesting.value,
        [key]: testing,
      }
    }

    const isCustomRuleParamTesting = (option: CustomRuleParamOption) =>
      customRuleParamTesting.value[`${option.type}:${option.name}`] ?? false

    const testCustomRuleParamOption = async (option: CustomRuleParamOption) => {
      if (option.type === 'builtin' || isCustomRuleParamTesting(option)) return

      setCustomRuleParamTesting(option, true)
      try {
        await proxyLatencyTest(
          getCustomRuleParamLatencyTarget(option),
          getTestUrl(getCustomRuleParamLatencyGroup(option)),
        )
      } catch {
        // The latency helper shows the request result to the user.
      } finally {
        setCustomRuleParamTesting(option, false)
      }
    }

    const testCurrentCustomRuleParamTab = async () => {
      if (isCustomRuleParamTestingAll.value) return

      const options = customRuleParamTestableOptions.value
      const nodesByUrl = new Map<string, Set<string>>()

      options.forEach((option) => {
        const node = getCustomRuleParamLatencyTarget(option)

        if (!node) return

        const url = getTestUrl(getCustomRuleParamLatencyGroup(option))
        const nodes = nodesByUrl.get(url) || new Set<string>()
        nodes.add(node)
        nodesByUrl.set(url, nodes)
      })

      if (nodesByUrl.size === 0) return

      isCustomRuleParamTestingAll.value = true
      options.forEach((option) => setCustomRuleParamTesting(option, true))

      try {
        let testIndex = 0

        for (const [url, nodes] of nodesByUrl) {
          await proxyNodesLatencyTest('domain-rule-param', [...nodes], {
            displayName: t('params'),
            keyName: `domain-rule-param-${customRuleParamTab.value}-${testIndex++}`,
            url,
          })
        }
      } finally {
        options.forEach((option) => setCustomRuleParamTesting(option, false))
        isCustomRuleParamTestingAll.value = false
      }
    }

    const restartProxyAndReloadDomainRules = async () => {
      const response = await fetchServerApi('/api/proxy-domain-rules/reload', {
        method: 'POST',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(data?.message || `Failed to reload proxy rules: ${response.status}`)
      }

      showNotification({
        key: 'proxy-restart-progress',
        content: 'restartProxyRefreshing',
        type: 'alert-info',
        timeout: 0,
      })

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1000)
      })
      await Promise.all([fetchProxies(), fetchRules()])
      domainRuleConfigChanged.value = false
      domainRulesReloadRevision.value += 1
    }

    const submitAddDomainRule = async () => {
      if (isAddingDomainRule.value || !canAddDomainRule.value || !domainRuleForm.value.param.trim())
        return
      const validationError = validateDomainRuleForm()

      if (validationError) {
        showNotification({
          key: 'domainRuleInputInvalid',
          content: validationError.content,
          params: validationError.params,
          type: 'alert-error',
        })
        return
      }

      isAddingDomainRule.value = true

      try {
        const response = await fetchServerApi('/api/proxy-domain-rules', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            value: domainRuleForm.value.value,
            target: domainRuleForm.value.param,
            type: domainRuleForm.value.type,
            customGroupMode: selectedCustomGroupMode.value,
          }),
        })
        const data = (await response.json().catch(() => null)) as {
          message?: string
          changed?: boolean
          duplicated?: boolean
          rule?: string
        } | null

        if (!response.ok) {
          throw new Error(data?.message || `Failed to add domain rule: ${response.status}`)
        }

        if (data?.changed) {
          domainRuleConfigChanged.value = true
          domainRulesReloadRevision.value += 1
          domainRuleForm.value.value = ''
          addDomainRuleModal.value = false
          showNotification({
            key: `domain-rule-added-${data.rule || Date.now()}`,
            content: 'domainRuleAdded',
            type: 'alert-warning',
          })
        } else if (data?.duplicated) {
          showNotification({
            key: `domain-rule-duplicated-${data.rule || domainRuleForm.value.value}`,
            content: 'domainRuleDuplicated',
            type: 'alert-info',
          })
          domainRuleForm.value.value = ''
          addDomainRuleModal.value = false
        }
      } catch (error) {
        console.error(error)
        showNotification({
          key: 'domainRuleAddFailed',
          content: 'domainRuleAddFailed',
          type: 'alert-error',
        })
      } finally {
        isAddingDomainRule.value = false
      }
    }

    const handlerClickRestartProxy = async () => {
      if (isRestartingProxy.value || !domainRuleConfigChanged.value) return
      isRestartingProxy.value = true
      showNotification({
        key: 'proxy-restart-progress',
        content: 'restartProxyInProgress',
        type: 'alert-info',
        timeout: 0,
      })

      try {
        await restartProxyAndReloadDomainRules()
        showNotification({
          key: 'proxy-restart-progress',
          content: 'restartProxySuccess',
          type: 'alert-success',
        })
      } catch (restartError) {
        console.error(restartError)
        showNotification({
          key: 'proxy-restart-progress',
          content: 'restartProxyFailed',
          type: 'alert-error',
          timeout: 5000,
        })
      } finally {
        isRestartingProxy.value = false
      }
    }

    const globalCollapseTargets = computed<GlobalCollapseTarget[]>(() => {
      if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) {
        return renderGroups.value.map((name) => ({
          type: 'group',
          key: `penetration:${name}:level-1`,
        }))
      }

      if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
        const targets: GlobalCollapseTarget[] = []

        renderGroups.value.forEach((providerName) => {
          const provider = proxyProviederList.value.find((item) => item.name === providerName)

          if (!provider) {
            return
          }

          const providerAllProxies = provider.proxies.map((node) => node.name)
          const wildcard = providerProxyCategoryWildcardMap.value[providerName] ?? ''
          const categoryEnabled =
            providerProxyCategoryFeatureEnabled.value &&
            isProxyCategoryEnabled(
              providerAllProxies,
              wildcard,
              providerProxyCategoryEnabledMap.value[providerName] ?? false,
            )

          if (!categoryEnabled) {
            targets.push({
              type: 'group',
              key: providerName,
            })
            return
          }

          buildProxyCategoryGroups(
            providerAllProxies,
            wildcard,
            t('other'),
            providerAllProxies,
          ).forEach(({ name: categoryName }) => {
            targets.push({
              type: 'provider-category',
              key: getProxyCategoryCollapseKey(providerName, categoryName),
            })
          })
        })

        return targets
      }

      return renderGroups.value.map((name) => ({
        type: 'group',
        key: name,
      }))
    })

    const hasExpandedTargets = computed(() => {
      return globalCollapseTargets.value.some((target) => {
        if (target.type === 'provider-category') {
          return !providerProxyCategoryCollapseMap.value[target.key]
        }

        return Boolean(collapseGroupMap.value[target.key])
      })
    })

    const handlerClickToggleCollapse = () => {
      const nextCollapseGroupMap = { ...collapseGroupMap.value }
      const nextProviderProxyCategoryCollapseMap = {
        ...providerProxyCategoryCollapseMap.value,
      }

      globalCollapseTargets.value.forEach((target) => {
        if (target.type === 'provider-category') {
          nextProviderProxyCategoryCollapseMap[target.key] = hasExpandedTargets.value
          return
        }

        nextCollapseGroupMap[target.key] = !hasExpandedTargets.value
      })

      collapseGroupMap.value = nextCollapseGroupMap
      providerProxyCategoryCollapseMap.value = nextProviderProxyCategoryCollapseMap
    }

    const handlerResetProxyCardWidth = () => {
      minProxyCardWidth.value = getMinCardWidth(proxyCardSize.value)
    }

    const tabsWithNumbers = computed(() => {
      return Object.values(PROXY_TAB_TYPE).map((type) => {
        return {
          type,
          count:
            type === PROXY_TAB_TYPE.POLICY
              ? policyGroups.value.length
              : type === PROXY_TAB_TYPE.DOMAIN
                ? domainGroups.value.length
                : type === PROXY_TAB_TYPE.NODE
                  ? nodeGroups.value.length
                  : proxyProviederList.value.length,
        }
      })
    })

    return () => {
      const isProviderTab = proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER
      const moveRefreshToSecondRow = !isLargeCtrlsBar.value && isProviderTab

      const tabs = (
        <div
          role="tablist"
          class="proxy-main-tabs tabs-box tabs tabs-xs"
        >
          {tabsWithNumbers.value.map(({ type, count }) => {
            const label = t(type)

            return (
              <a
                role="tab"
                key={type}
                class={['tab', proxiesTabShow.value === type && 'tab-active']}
                onClick={() => (proxiesTabShow.value = type)}
              >
                {label} ({count})
              </a>
            )
          })}
        </div>
      )

      const upgradeAllIcon = proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER && (
        <button
          class="btn btn-circle btn-sm"
          onClick={handlerClickUpdateAllProviders}
        >
          <ArrowPathIcon class={['h-4 w-4', isUpgrading.value && 'animate-spin']} />
        </button>
      )

      const modeSelect = proxiesTabShow.value === PROXY_TAB_TYPE.POLICY && configs.value && (
        <select
          class={[
            'select select-sm shrink-0',
            isLargeCtrlsBar.value ? 'min-w-40' : 'w-20 min-w-20',
          ]}
          v-model={configs.value.mode}
          onChange={handlerModeChange}
        >
          {modeList.value.map((mode) => {
            return (
              <option
                key={mode}
                value={mode}
              >
                {needTranslateModes.value ? t(mode.toLowerCase()) : mode}
              </option>
            )
          })}
        </select>
      )

      const sort = (
        <select
          class={['select select-sm']}
          v-model={proxySortType.value}
        >
          {Object.values(PROXY_SORT_TYPE).map((type) => {
            return (
              <option
                key={type}
                value={type}
              >
                {t(type)}
              </option>
            )
          })}
        </select>
      )

      const latencyTestAll = (
        <button
          class="btn btn-circle btn-sm"
          onClick={handlerClickLatencyTestAll}
        >
          {isAllLatencyTesting.value ? (
            <span class="loading loading-spinner loading-sm"></span>
          ) : (
            <BoltIcon class="h-4 w-4" />
          )}
        </button>
      )

      const toggleCollapseAll = (
        <button
          class={[
            'btn btn-circle btn-sm',
            twoColumnProxyGroup.value &&
              proxiesTabShow.value !== PROXY_TAB_TYPE.PROVIDER &&
              'max-sm:hidden',
          ]}
          onClick={handlerClickToggleCollapse}
        >
          {hasExpandedTargets.value ? (
            <ChevronUpIcon class="h-4 w-4" />
          ) : (
            <ChevronDownIcon class="h-4 w-4" />
          )}
        </button>
      )

      const searchInput = (
        <TextInput
          class={[
            isLargeCtrlsBar.value
              ? 'w-32 max-w-80 flex-1'
              : moveRefreshToSecondRow
                ? 'w-full'
                : 'w-32 flex-1',
          ]}
          v-model={proxiesFilter.value}
          placeholder={`${t('search')} | ${t('searchMultiple')}`}
          clearable={true}
        />
      )

      const searchSection = <div class={['flex min-w-0 flex-1 items-center']}>{searchInput}</div>

      const domainSearchInput = (
        <TextInput
          class="min-w-0 flex-1 md:max-w-sm lg:max-w-md xl:max-w-lg"
          v-model={domainGroupSearch.value}
          placeholder={t('domainPenetrationSearchPlaceholder')}
          clearable={true}
        />
      )

      const addDomainRuleDialog = (
        <DialogWrapper
          v-model={addDomainRuleModal.value}
          title={t('addDomainRule')}
          boxClass="w-[min(32rem,calc(100vw-2rem))] max-w-none"
          contentClass="overflow-visible!"
        >
          <form
            class="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitAddDomainRule()
            }}
          >
            <div class="text-base-content/70 text-sm">
              {t('addDomainRuleTarget', {
                group: selectedDomainGroupLabel.value || '-',
              })}
            </div>

            <label class="form-control gap-1">
              <span class="label-text text-sm">{t('ruleType')}</span>
              <select
                class="select select-sm w-full"
                v-model={domainRuleForm.value.type}
              >
                {proxyDirectRuleTypes.map((type) => (
                  <option
                    key={type.value}
                    value={type.value}
                  >
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            <label class="form-control gap-1">
              <span class="label-text text-sm">
                {isIpDomainRuleType.value ? t('ip') : t('domain')}
              </span>
              <TextInput
                v-model={domainRuleForm.value.value}
                placeholder={domainRuleValuePlaceholder.value}
                clearable={true}
              />
            </label>

            {isSelectedCustomDomainGroup.value && (
              <div class="form-control gap-2">
                <span class="label-text text-sm">{t('params')}</span>
                <div class="relative">
                  <button
                    type="button"
                    class={[
                      'select select-sm flex w-full cursor-pointer items-center justify-between gap-2 pr-9 text-left',
                      isCustomRuleParamDropdownOpen.value && 'select-primary',
                    ]}
                    onClick={() => {
                      if (!isCustomRuleParamDropdownOpen.value) {
                        customRuleParamTab.value = 'group'
                      }

                      isCustomRuleParamDropdownOpen.value = !isCustomRuleParamDropdownOpen.value
                    }}
                  >
                    <span class="min-w-0 flex-1 truncate">
                      {selectedCustomRuleParamOption.value?.name || domainRuleForm.value.param}
                    </span>
                    <ChevronDownIcon
                      class={[
                        'h-4 w-4 shrink-0 transition-transform',
                        isCustomRuleParamDropdownOpen.value && 'rotate-180',
                      ]}
                    />
                  </button>

                  {isCustomRuleParamDropdownOpen.value && (
                    <div class="border-base-300 bg-base-100! absolute right-0 bottom-full left-0 z-[70] mb-2 rounded-md border [background-color:var(--color-base-100)] p-2 shadow-xl backdrop-blur-none!">
                      <div class="flex min-w-0 items-center gap-2">
                        <div
                          role="tablist"
                          class="bg-base-200/80 inline-flex h-8 min-w-max shrink-0 items-center gap-1 rounded-md p-1"
                        >
                          <button
                            type="button"
                            role="tab"
                            class={[
                              'h-6 shrink-0 cursor-pointer rounded-md px-3 text-sm leading-6 font-medium whitespace-nowrap transition-colors',
                              customRuleParamTab.value === 'group'
                                ? 'bg-base-100 text-base-content shadow-sm'
                                : 'text-base-content/60 hover:text-base-content',
                            ]}
                            onClick={() => {
                              customRuleParamTab.value = 'group'
                            }}
                          >
                            {t('proxyParamGroup')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            class={[
                              'h-6 shrink-0 cursor-pointer rounded-md px-3 text-sm leading-6 font-medium whitespace-nowrap transition-colors',
                              customRuleParamTab.value === 'node'
                                ? 'bg-base-100 text-base-content shadow-sm'
                                : 'text-base-content/60 hover:text-base-content',
                            ]}
                            onClick={() => {
                              customRuleParamTab.value = 'node'
                            }}
                          >
                            {t('proxyParamNode')}
                          </button>
                        </div>
                        <TextInput
                          class="min-w-0 flex-1"
                          v-model={customRuleParamSearch.value}
                          placeholder={t('search')}
                          clearable={true}
                        />
                        <button
                          type="button"
                          class="btn btn-circle btn-sm shrink-0"
                          disabled={
                            isCustomRuleParamTestingAll.value ||
                            customRuleParamTestableOptions.value.length === 0
                          }
                          title={t('latency')}
                          onClick={() => void testCurrentCustomRuleParamTab()}
                        >
                          {isCustomRuleParamTestingAll.value ? (
                            <span class="loading loading-spinner loading-sm" />
                          ) : (
                            <BoltIcon class="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      <div class="border-base-300/70 bg-base-100! mt-2 max-h-44 overflow-y-auto rounded-md border [background-color:var(--color-base-100)] backdrop-blur-none!">
                        {filteredCustomRuleParamOptions.value.length === 0 ? (
                          <div class="text-base-content/60 flex h-16 items-center justify-center text-sm">
                            {t('noData')}
                          </div>
                        ) : (
                          filteredCustomRuleParamOptions.value.map((option) => {
                            const selected = domainRuleForm.value.param === option.name

                            return (
                              <div
                                key={`${option.type}:${option.name}`}
                                class={[
                                  'hover:bg-base-200 flex min-h-10 items-center gap-2 px-3 py-2 text-sm transition-colors',
                                  selected && 'bg-primary/10',
                                ]}
                              >
                                <button
                                  type="button"
                                  class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                                  onClick={() => selectCustomRuleParam(option.name)}
                                >
                                  <span class="h-4 w-4 shrink-0">
                                    {selected && <CheckIcon class="h-4 w-4" />}
                                  </span>
                                  <span class="min-w-0 flex-1 truncate">{option.name}</span>
                                  {option.description && (
                                    <span class="text-base-content/55 shrink-0 text-xs">
                                      {option.description}
                                    </span>
                                  )}
                                  {option.type !== 'builtin' && (
                                    <span class="text-base-content/45 hidden shrink-0 text-xs md:inline">
                                      {option.type === 'group'
                                        ? t('proxyParamGroup')
                                        : t('proxyParamNode')}
                                    </span>
                                  )}
                                </button>
                                {option.type !== 'builtin' && (
                                  <div
                                    class="shrink-0 cursor-pointer"
                                    onClick={() => void testCustomRuleParamOption(option)}
                                  >
                                    <LatencyTag
                                      class="bg-base-200/50 hover:bg-base-200 cursor-pointer"
                                      name={getCustomRuleParamLatencyTarget(option)}
                                      groupName={getCustomRuleParamLatencyGroup(option)}
                                      loading={isCustomRuleParamTesting(option)}
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div class="pending-restart-dialog-footer modal-action mt-1">
              <p class="pending-restart-dialog-hint">{t('addDomainRuleHint')}</p>
              <div class="pending-restart-dialog-actions">
                <button
                  type="button"
                  class="btn btn-sm"
                  onClick={() => (addDomainRuleModal.value = false)}
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  class="btn btn-primary btn-sm"
                  disabled={
                    isAddingDomainRule.value ||
                    !domainRuleForm.value.value.trim() ||
                    !domainRuleForm.value.param.trim()
                  }
                >
                  {isAddingDomainRule.value && (
                    <span class="loading loading-spinner loading-sm"></span>
                  )}
                  {t('confirm')}
                </button>
              </div>
            </div>
          </form>
        </DialogWrapper>
      )

      const domainActions = (
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            class={[
              'btn btn-circle btn-sm',
              canAddDomainRule.value ? 'btn-primary' : 'btn-disabled',
            ]}
            disabled={!canAddDomainRule.value}
            aria-disabled={!canAddDomainRule.value}
            onClick={openAddDomainRuleModal}
            title={canAddDomainRule.value ? t('addDomainRule') : t('addDomainRuleUnavailable')}
          >
            <PlusIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-circle btn-sm"
            disabled={!domainRuleConfigChanged.value || isRestartingProxy.value}
            onClick={handlerClickRestartProxy}
            title={t('restartProxy')}
          >
            {isRestartingProxy.value ? (
              <span class="loading loading-spinner loading-sm"></span>
            ) : (
              <ArrowPathIcon class="h-4 w-4" />
            )}
          </button>
          {addDomainRuleDialog}
        </div>
      )

      const settingsModal = (
        <>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => (settingsModel.value = true)}
          >
            <WrenchScrewdriverIcon class="h-4 w-4" />
          </button>
          <DialogWrapper
            v-model={settingsModel.value}
            title={t('proxySettings')}
          >
            <div class="flex flex-col gap-4 p-2 text-sm">
              <div class="flex items-center gap-2">
                {t('sortBy')}
                {sort}
              </div>
              {hasSmartGroup.value && (
                <div class="flex items-center gap-2">
                  {t('useSmartGroupSort')}
                  <input
                    class="toggle"
                    type="checkbox"
                    v-model={useSmartGroupSort.value}
                  />
                </div>
              )}
              <div class="flex items-center gap-2">
                {t('groupProxiesByProvider')}
                <input
                  type="checkbox"
                  class="toggle"
                  v-model={groupProxiesByProvider.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('unavailableProxy')}
                <input
                  type="checkbox"
                  class="toggle"
                  v-model={hideUnavailableProxies.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('manageHiddenGroup')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={manageHiddenGroup.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('automaticDisconnection')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={automaticDisconnection.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('displayFinalOutbound')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={displayFinalOutbound.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('minProxyCardWidth')}
                <div class="join">
                  <input
                    class="input input-sm join-item w-20"
                    type="number"
                    v-model={minProxyCardWidth.value}
                  />
                  <button
                    class="btn join-item btn-sm"
                    onClick={handlerResetProxyCardWidth}
                  >
                    {t('reset')}
                  </button>
                </div>
              </div>
              <div class="divider m-0"></div>
              <button
                class="btn btn-block"
                onClick={() => {
                  settingsModel.value = false
                  router.push({
                    name: ROUTE_NAME.settings,
                    query: { scrollTo: SETTINGS_MENU_KEY.proxies },
                  })
                }}
              >
                {t('moreSettings')}
              </button>
            </div>
          </DialogWrapper>
        </>
      )

      if (proxiesTabShow.value === PROXY_TAB_TYPE.DOMAIN) {
        return (
          <div class="ctrls-bar">
            <div class="proxy-domain-ctrls app-card-padding flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <div class="proxy-domain-tabs-row min-w-0 shrink-0">{tabs}</div>
              <div class="proxy-domain-search-row flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-1">
                {domainSearchInput}
                {domainActions}
              </div>
            </div>
          </div>
        )
      }

      const content = !isLargeCtrlsBar.value ? (
        <div class="app-card-padding flex flex-col gap-2">
          <div class="flex gap-2">
            {tabs}
            {!moveRefreshToSecondRow && upgradeAllIcon}
          </div>
          <div class="flex w-full gap-2">
            {modeSelect}
            {searchSection}
            <div class="ml-auto flex shrink-0 items-center gap-2">
              {moveRefreshToSecondRow && upgradeAllIcon}
              {settingsModal}
              {toggleCollapseAll}
              {latencyTestAll}
            </div>
          </div>
        </div>
      ) : (
        <div class="app-card-padding flex gap-2">
          {tabs}
          {modeSelect}
          {searchSection}
          {upgradeAllIcon}
          {settingsModal}
          {toggleCollapseAll}
          {latencyTestAll}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
