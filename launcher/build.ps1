# Compila o lançador "Painel Sites Express.exe" na raiz do projeto.
#
# Usa o csc do .NET Framework 4, que já vem no Windows — não precisa de SDK.
# Rode de novo depois de mover a pasta do projeto: o caminho dela fica gravado
# no .exe, para ele funcionar mesmo copiado para a Área de Trabalho.
#
#   powershell -ExecutionPolicy Bypass -File launcher\build.ps1

$ErrorActionPreference = "Stop"
$launcher = $PSScriptRoot
$raiz = Split-Path $launcher -Parent
$saida = Join-Path $raiz "Painel Sites Express.exe"
$obj = Join-Path $launcher "obj"
New-Item -ItemType Directory -Force $obj | Out-Null

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "csc.exe do .NET Framework 4 não encontrado." }

# O caminho do projeto, gravado no executável.
$raizCs = $raiz.Replace('\', '\\').Replace('"', '\"')
$compilacao = @"
namespace PainelLauncher
{
    static class Compilacao
    {
        public const string RaizDoProjeto = "$raizCs";
    }
}
"@
[IO.File]::WriteAllText((Join-Path $obj "Compilacao.cs"), $compilacao, (New-Object Text.UTF8Encoding $true))

# Ícone: o favicon do painel, centralizado num quadrado de 256 px, embutido
# como PNG dentro do .ico (formato aceito desde o Windows Vista).
Add-Type -AssemblyName System.Drawing
$favicon = Join-Path $raiz "web\public\favicon.png"
$ico = Join-Path $obj "painel.ico"
$img = [Drawing.Image]::FromFile($favicon)
try {
    $lado = 256
    $bmp = New-Object Drawing.Bitmap $lado, $lado
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $escala = [Math]::Min($lado / $img.Width, $lado / $img.Height)
    $w = [int]($img.Width * $escala); $h = [int]($img.Height * $escala)
    $g.DrawImage($img, [int](($lado - $w) / 2), [int](($lado - $h) / 2), $w, $h)
    $g.Dispose()
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $png = $ms.ToArray()
} finally { $img.Dispose() }

$fs = [IO.File]::Create($ico)
$bw = New-Object IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)      # cabeçalho: ícone, 1 imagem
$bw.Write([byte]0); $bw.Write([byte]0)                                  # 0 = 256 px
$bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
$bw.Write($png)
$bw.Close()

& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
    "/out:$saida" "/win32icon:$ico" `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
    (Join-Path $launcher "PainelLauncher.cs") (Join-Path $obj "Compilacao.cs")
if ($LASTEXITCODE -ne 0) { throw "A compilação falhou." }
Write-Host "Gerado: $saida"
