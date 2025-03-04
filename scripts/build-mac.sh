#!/bin/bash

# 检测系统架构
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    ARCH_FLAG="arm64"
elif [ "$ARCH" = "x86_64" ]; then
    ARCH_FLAG="x64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "Detected architecture: $ARCH_FLAG"

# 安装依赖
echo "Installing dependencies..."
bun install
bun add @mihomo-party/sysproxy-darwin-$ARCH_FLAG
bun prepare --$ARCH_FLAG

# 第一次构建
echo "First build to generate app..."
bun build:mac --$ARCH_FLAG

# 安装到 Applications
echo "Installing to Applications..."
sudo rm -rf "/Applications/Mihomo Party.app"
sudo cp -R "dist/mac-$ARCH_FLAG/Mihomo Party.app" "/Applications/"

# 设置权限
echo "Setting permissions..."
cd dist/mac-$ARCH_FLAG || exit 1
sudo chown root:admin "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo"
sudo chown root:admin "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo-alpha"
sudo chmod +s "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo"
sudo chmod +s "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo-alpha"

# 安装 helper 服务
echo "Installing helper service..."
sudo mkdir -p /Library/PrivilegedHelperTools
sudo cp "/Applications/Mihomo Party.app/Contents/Resources/files/party.mihomo.helper" "/Library/PrivilegedHelperTools/"
sudo chown root:wheel "/Library/PrivilegedHelperTools/party.mihomo.helper"
sudo chmod 544 "/Library/PrivilegedHelperTools/party.mihomo.helper"

# 配置 LaunchDaemon
echo "Configuring LaunchDaemon..."
sudo mkdir -p /Library/LaunchDaemons
cat << EOF | sudo tee /Library/LaunchDaemons/party.mihomo.helper.plist > /dev/null
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
        <key>Label</key>
        <string>party.mihomo.helper</string>
        <key>MachServices</key>
        <dict>
                <key>party.mihomo.helper</key>
                <true/>
        </dict>
        <key>KeepAlive</key>
        <true/>
        <key>Program</key>
        <string>/Library/PrivilegedHelperTools/party.mihomo.helper</string>
        <key>ProgramArguments</key>
        <array>
                <string>/Library/PrivilegedHelperTools/party.mihomo.helper</string>
        </array>
        <key>StandardErrorPath</key>
        <string>/tmp/party.mihomo.helper.err</string>
        <key>StandardOutPath</key>
        <string>/tmp/party.mihomo.helper.log</string>
</dict>
</plist>
EOF

sudo chown root:wheel /Library/LaunchDaemons/party.mihomo.helper.plist
sudo chmod 644 /Library/LaunchDaemons/party.mihomo.helper.plist

# 加载并启动服务
echo "Loading and starting helper service..."
sudo launchctl unload /Library/LaunchDaemons/party.mihomo.helper.plist 2>/dev/null || true
if ! sudo launchctl load /Library/LaunchDaemons/party.mihomo.helper.plist; then
    echo "Failed to load helper service"
    exit 1
fi

if ! sudo launchctl start party.mihomo.helper; then
    echo "Failed to start helper service"
    exit 1
fi

cd ../..

# 最终打包
echo "Final packaging..."
bun build:mac --$ARCH_FLAG

echo "Build completed! Check the dist directory for the output files."
echo "Generated files:"
ls -l dist/*.{dmg,pkg,sha256} 2>/dev/null

exit 0
