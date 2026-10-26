<#
将选定的生成图标等比例降采样为安装包使用的 PNG。
Source 为原图路径；Destination 为工作区输出路径；Size 为图标边长。
只处理栅格尺寸，不改变图案设计；原图保持不变。
#>
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [int]$Size = 256
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskDestination = [System.IO.Path]::GetFullPath($Destination)
$taskDirectory = [System.IO.Path]::GetDirectoryName($taskDestination)
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskImage = [System.Drawing.Image]::FromFile($Source)
$taskBitmap = [System.Drawing.Bitmap]::new($Size, $Size)
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskAttributes = [System.Drawing.Imaging.ImageAttributes]::new()
try {
    if ($taskImage.Width -ne $taskImage.Height) { throw 'Icon source must be square' }
    # 使用高质量插值和镜像边缘采样，避免图标四周产生浅色细线。
    $taskGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $taskGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $taskGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $taskAttributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $taskGraphics.DrawImage($taskImage, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size), 0, 0, $taskImage.Width, $taskImage.Height, [System.Drawing.GraphicsUnit]::Pixel, $taskAttributes)
    $taskBitmap.Save($taskDestination, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Icon saved: $taskDestination (${Size}x${Size})"
} finally {
    $taskAttributes.Dispose()
    $taskGraphics.Dispose()
    $taskBitmap.Dispose()
    $taskImage.Dispose()
}
