# Gera as falas do NEON RADIO NETWORK com as vozes locais do Windows (System.Speech / SAPI).
# Sem rede: usa só as vozes instaladas (Microsoft Maria Desktop pt-BR, Microsoft Zira Desktop en-US).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools/radio/tts.ps1 -Jobs <arquivo.json> -OutDir <pasta>
# Jobs: [{ "id": "...", "voice": "Microsoft Maria Desktop", "rate": 0, "text": "..." }]
param([string]$Jobs, [string]$OutDir)
Add-Type -AssemblyName System.Speech
$list = Get-Content -Raw -Encoding UTF8 $Jobs | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutDir | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$n = 0
foreach ($j in $list) {
  $out = Join-Path $OutDir ($j.id + '.wav')
  if ((Test-Path $out) -and -not $j.force) { continue }
  $synth.SelectVoice($j.voice)
  $synth.Rate = [int]$j.rate
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($out, $fmt)
  $synth.Speak([string]$j.text)
  $synth.SetOutputToNull()
  $n++
}
$synth.Dispose()
Write-Output "TTS_DONE $n"
