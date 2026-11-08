/**
 * VTT 파서 - WebVTT 파일을 파싱하여 자막 큐 배열로 변환
 *
 * 반환 형식: [{ startTime: 초, endTime: 초, text: "자막 텍스트" }, ...]
 */
function parseVTT(vttText) {
  const cues = [];

  // BOM 제거
  let text = vttText.replace(/^\uFEFF/, '');

  // WEBVTT 헤더 제거
  text = text.replace(/^WEBVTT.*\n/, '');
  text = text.replace(/^NOTE.*\n(?:.*\n)*?\n/gm, '');
  text = text.replace(/^Kind:.*\n/gm, '');
  text = text.replace(/^Language:.*\n/gm, '');
  text = text.replace(/^STYLE[\s\S]*?\n\n/gm, '');

  // 블록 단위로 분리
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    // 타임코드 라인 찾기
    let timecodeIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timecodeIndex = i;
        break;
      }
    }
    if (timecodeIndex === -1) continue;

    // 타임코드 파싱
    const timeMatch = lines[timecodeIndex].match(
      /(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})/
    );
    if (!timeMatch) continue;

    const startTime = parseTimestamp(timeMatch[1]);
    const endTime = parseTimestamp(timeMatch[2]);

    // 텍스트 추출 (HTML 태그 제거)
    const subtitleText = lines
      .slice(timecodeIndex + 1)
      .map((line) => line.replace(/<\/?[^>]+>/g, '').trim())
      .filter((line) => line.length > 0)
      .join('\n');

    if (!subtitleText) continue;

    cues.push({ startTime, endTime, text: subtitleText });
  }

  return cues;
}

/**
 * 타임스탬프 문자열을 초 단위로 변환
 * "00:01:23.456" → 83.456
 * "01:23.456" → 83.456
 */
function parseTimestamp(ts) {
  // 콤마를 점으로 통일
  ts = ts.replace(',', '.');

  const parts = ts.split(':');
  if (parts.length === 3) {
    return (
      parseInt(parts[0]) * 3600 +
      parseInt(parts[1]) * 60 +
      parseFloat(parts[2])
    );
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

/**
 * 주어진 시간(초)에 해당하는 자막 큐를 찾기
 */
function findActiveCue(cues, currentTime) {
  for (const cue of cues) {
    if (currentTime >= cue.startTime && currentTime < cue.endTime) {
      return cue;
    }
  }
  return null;
}
