/**
 * WebVTT → SRT 변환기
 *
 * VTT와 SRT의 차이점:
 * 1. SRT는 순번이 필요 (1, 2, 3, ...)
 * 2. 타임코드 구분자: VTT는 "." / SRT는 ","
 * 3. SRT는 WEBVTT 헤더 불필요
 * 4. VTT의 <i>, <b> 등 HTML 태그 제거
 */
function vttToSrt(vttText) {
  // BOM 제거
  let text = vttText.replace(/^\uFEFF/, '');

  // WEBVTT 헤더 및 메타데이터 제거
  text = text.replace(/^WEBVTT.*\n/m, '');
  text = text.replace(/^NOTE.*\n(?:.*\n)*?\n/gm, '');
  text = text.replace(/^Kind:.*\n/gm, '');
  text = text.replace(/^Language:.*\n/gm, '');
  text = text.replace(/^STYLE[\s\S]*?\n\n/gm, '');

  // 블록 단위로 분리
  const blocks = text.trim().split(/\n\s*\n/);
  const srtBlocks = [];
  let counter = 1;

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

    // 타임코드 변환 (. → ,) 및 position 메타데이터 제거
    let timecode = lines[timecodeIndex];
    // VTT position/alignment 설정 제거 (예: align:start position:10%)
    timecode = timecode.replace(/\s+(align|position|size|line|vertical):[\w.%-]+/g, '');
    // 밀리초 구분자 변환
    timecode = timecode.replace(/\./g, ',');

    // 타임코드에 시간(hour) 부분이 없으면 추가
    timecode = timecode.replace(
      /(\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2},\d{3})/,
      '00:$1 --> 00:$2'
    );

    // 자막 텍스트 추출 (타임코드 다음 줄부터)
    const textLines = lines.slice(timecodeIndex + 1);
    if (textLines.length === 0) continue;

    // HTML 태그 제거 (<i>, <b>, <u>, <font> 등)
    const cleanText = textLines
      .map((line) => line.replace(/<\/?[^>]+>/g, '').trim())
      .filter((line) => line.length > 0)
      .join('\n');

    if (!cleanText) continue;

    srtBlocks.push(`${counter}\n${timecode}\n${cleanText}`);
    counter++;
  }

  return srtBlocks.join('\n\n') + '\n';
}
