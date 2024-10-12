import {
  getControledMihomoConfig,
  getProfileConfig,
  getProfile,
  getProfileItem,
  getOverride,
  getOverrideItem,
  getOverrideConfig
} from '../config'
import {
  mihomoProfileWorkDir,
  mihomoWorkConfigPath,
  overridePath,
  resourcesFilesDir
} from '../utils/dirs'
import yaml from 'yaml'
import { link, mkdir, writeFile } from 'fs/promises'
import { deepMerge } from '../utils/merge'
import vm from 'vm'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'

let runtimeConfigStr: string
let runtimeConfig: IMihomoConfig

export async function generateProfile(): Promise<void> {
  const { current } = await getProfileConfig()
  const currentProfile = await overrideProfile(current, await getProfile(current))
  const controledMihomoConfig = await getControledMihomoConfig()
  const profile = deepMerge(currentProfile, controledMihomoConfig)
  // 确保可以拿到基础日志信息
  profile['log-level'] = 'info'
  runtimeConfig = profile
  runtimeConfigStr = yaml.stringify(profile)
  await prepareProfileWorkDir(current)
  await writeFile(mihomoWorkConfigPath(current), runtimeConfigStr)
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  if (!existsSync(mihomoProfileWorkDir(current))) {
    await mkdir(mihomoProfileWorkDir(current), { recursive: true })
  }
  const ln = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoProfileWorkDir(current), file)

    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      await link(sourcePath, targetPath)
    }
  }
  await Promise.all([ln('country.mmdb'), ln('geoip.dat'), ln('geosite.dat'), ln('ASN.mmdb')])
}

async function overrideProfile(
  current: string | undefined,
  profile: IMihomoConfig
): Promise<IMihomoConfig> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const { override = [] } = (await getProfileItem(current)) || {}
  for (const ov of new Set(globalOverride.concat(override))) {
    const item = await getOverrideItem(ov)
    const content = await getOverride(ov, item?.ext || 'js')
    switch (item?.ext) {
      case 'js':
        profile = runOverrideScript(profile, content, item)
        break
      case 'yaml': {
        let patch = yaml.parse(content, { merge: true }) || {}
        if (typeof patch !== 'object') patch = {}
        profile = deepMerge(profile, patch)
        break
      }
    }
  }
  return profile
}

function runOverrideScript(
  profile: IMihomoConfig,
  script: string,
  item: IOverrideItem
): IMihomoConfig {
  const log = (type: string, data: string, flag = 'a'): void => {
    writeFileSync(overridePath(item.id, 'log'), `[${type}] ${data}\n`, {
      encoding: 'utf-8',
      flag
    })
  }
  try {
    const ctx = {
      console: Object.freeze({
        log(data: never) {
          log('log', JSON.stringify(data))
        },
        info(data: never) {
          log('info', JSON.stringify(data))
        },
        error(data: never) {
          log('error', JSON.stringify(data))
        },
        debug(data: never) {
          log('debug', JSON.stringify(data))
        }
      })
    }
    vm.createContext(ctx)
    const code = `${script} main(${JSON.stringify(profile)})`
    log('info', '开始执行脚本', 'w')
    const newProfile = vm.runInContext(code, ctx)
    if (typeof newProfile !== 'object') {
      throw new Error('脚本返回值必须是对象')
    }
    log('info', '脚本执行成功')
    return newProfile
  } catch (e) {
    log('exception', `脚本执行失败: ${e}`)
    return profile
  }
}

export async function getRuntimeConfigStr(): Promise<string> {
  return runtimeConfigStr
}

export async function getRuntimeConfig(): Promise<IMihomoConfig> {
  return runtimeConfig
}
