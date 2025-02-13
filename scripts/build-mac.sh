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
echo ``
echo "Setting permissions..."
cd dist/mac-$ARCH_FLAG || exit 1
sudo chown root:admin "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo"
sudo chown root:admin "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo-alpha"
sudo chmod +s "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo"
sudo chmod +s "/Applications/Mihomo Party.app/Contents/Resources/sidecar/mihomo-alpha"
cd ../..

# 最终打包
# echo "Final packaging..."
# bun build:mac --$ARCH_FLAG

echo "Build completed! Check the dist directory for the output files."
echo "Generated files:"
ls -l dist/*.{dmg,pkg,sha256} 2>/dev/null

exit 0