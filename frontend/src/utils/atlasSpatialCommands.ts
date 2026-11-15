const directions: Record<string, string> = {
  north: 'N', northeast: 'NE', east: 'E', southeast: 'SE',
  south: 'S', southwest: 'SW', west: 'W', northwest: 'NW'
};

export function parseAtlasSpatialCommand(input: string) {
  const text = input.toLowerCase()
    .replace(/^(?:(?:(?:hey|ok|okay) )?oracle[, ]+)?(?:please )?/, '')
    .replace(/[?.!]+$/, '').trim();
  if (/^what(?:['’]s| is) around me$/.test(text)) return { kind: 'context' } as const;
  const direction = /^which (?:ones|places) are (north|northeast|east|southeast|south|southwest|west|northwest) of me$/.exec(text);
  if (direction) return { kind: 'direction', bearing: directions[direction[1]] } as const;
  const area = /^which (.+?) are (?:inside|within|in) (?:this|the|my) (buffer|(?:(\d+)[- ]minute )?(?:(walking|cycling|driving|reachability) )?area)$/.exec(text);
  if (area) return {
    kind: 'area',
    term: area[1],
    area: area[2] === 'buffer' ? 'buffer' : 'reachability',
    minutes: area[3] ? Number(area[3]) : undefined,
    mode: area[4] && area[4] !== 'reachability' ? area[4] : undefined
  } as const;
  return null;
}
