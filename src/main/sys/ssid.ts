import { exec } from 'child_process'
import { promisify } from 'util'
import { getAppConfig, patchControledMihomoConfig, patchAppConfig } from '../config'
import { patchMihomoConfig } from '../core/mihomoApi'
import { mainWindow } from '..'
import { ipcMain, net } from 'electron'
import { getDefaultDevice, stopCore, startCore, recoverDNS } from '../core/manager'
import { triggerSysProxy } from './sysproxy'

export async function getCurrentSSID(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    try {
      return await getSSIDByNetsh()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'linux') {
    try {
      return await getSSIDByIwconfig()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    try {
      return await getSSIDByAirport()
    } catch {
      return await getSSIDByNetworksetup()
    }
  }
  return undefined
}

let lastSSID: string | undefined
export async function checkSSID(): Promise<void> {
  try {
    const { pauseSSID = [] } = await getAppConfig()
    if (pauseSSID.length === 0) return
    const currentSSID = await getCurrentSSID()
    if (currentSSID === lastSSID) return
    lastSSID = currentSSID
    if (currentSSID && pauseSSID.includes(currentSSID)) {
      console.log(`[SSID Check] Matched SSID: ${currentSSID}, switching to direct mode`)

      // 先停止核心服务以确保所有连接都被关闭
      await stopCore(true)

      // 更新配置
      await patchControledMihomoConfig({
        mode: 'direct',
        dns: { enable: false },
        tun: { enable: false }
      })

      // 确保系统代理关闭
      try {
        await triggerSysProxy(false)
        await patchAppConfig({ sysProxy: { enable: false } })

        // 确保 DNS 恢复
        await recoverDNS()
      } catch (e) {
        console.error('[SSID Check] Error disabling proxy:', e)
      }

      // 以新配置启动核心（direct模式）
      await startCore()

      // 通过 API 确保配置应用到运行中的 mihomo 核心
      await patchMihomoConfig({ mode: 'direct', dns: { enable: false } })

      // 更新 UI
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      mainWindow?.webContents.send('appConfigUpdated')
      ipcMain.emit('updateTrayMenu')
    } else {
      console.log(`[SSID Check] No matched SSID, switching to rule mode`)

      // 先停止核心服务以确保配置正确应用
      await stopCore(true)

      // 更新配置
      await patchControledMihomoConfig({
        mode: 'rule',
        dns: { enable: true },
        tun: { enable: true }
      })

      // 启动核心服务（使用新配置）
      await startCore()

      // 通过 API 确保配置应用到运行中的 mihomo 核心
      await patchMihomoConfig({ mode: 'rule', dns: { enable: true } })

      // 启用系统代理
      try {
        await triggerSysProxy(true)
        await patchAppConfig({ sysProxy: { enable: true } })
      } catch (e) {
        console.error('[SSID Check] Error enabling proxy:', e)
      }

      // 更新 UI
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      mainWindow?.webContents.send('appConfigUpdated')
      ipcMain.emit('updateTrayMenu')
    }
  } catch (error) {
    console.error('[SSID Check] Error:', error)
  }
}

export async function startSSIDCheck(): Promise<void> {
  await checkSSID()
  setInterval(checkSSID, 30000)
}

async function getSSIDByAirport(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I'
  )
  if (stdout.trim().startsWith('WARNING')) {
    throw new Error('airport cannot be used')
  }
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByNetworksetup(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  if (net.isOnline()) {
    const service = await getDefaultDevice()
    const { stdout } = await execPromise(`networksetup -listpreferredwirelessnetworks ${service}`)
    if (stdout.trim().startsWith('Preferred networks on')) {
      if (stdout.split('\n').length > 1) {
        return stdout.split('\n')[1].trim()
      }
    }
  }
  return undefined
}

async function getSSIDByNetsh(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise('netsh wlan show interfaces')
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByIwconfig(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    `iwconfig 2>/dev/null | grep 'ESSID' | awk -F'"' '{print $2}'`
  )
  if (stdout.trim() !== '') {
    return stdout.trim()
  }
  return undefined
}
