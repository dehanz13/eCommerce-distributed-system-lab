import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import layout from './backend-map.json';

/** Generate the offline Excalidraw scene from the console's fixed registry and pinned local icons.
 * Input: none; layout/labels come from backend-map.json, not runtime state or visitor input.
 * Communicates with local asset files only. Live status/logs belong to the console, never this static export.
 */
export function backendDiagram() {
  const files: Record<string, unknown> = {};
  let index = 0;
  /** Supply shared Excalidraw element metadata for one registry shape, label or image; no external communication. */
  const base = (id: string, type: string, x: number, y: number, width: number, height: number) => ({
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#334155',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: 'a0' + String(index++).padStart(4, '0') + 'V',
    roundness: null,
    seed: index,
    version: 1,
    versionNonce: index,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  });
  /** Describe one fixed text label supplied by the registry; input is label/coordinates, no network or database calls. */
  const text = (id: string, value: string, x: number, y: number, width = 190) => ({
    ...base(id, 'text', x, y, width, 22),
    text: value,
    originalText: value,
    fontSize: 16,
    fontFamily: 2,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
  const elements: unknown[] = layout.groups.flatMap((group) => [
    {
      ...base(group.id, 'rectangle', group.x, group.y, group.width, group.height),
      strokeStyle: 'dashed',
      roundness: { type: 3 },
    },
    text(group.id + '-label', group.label, group.x + 25, group.y + 10, group.width - 50),
    ...(group.note
      ? [
          {
            ...text(group.id + '-note', group.note, group.x + 25, group.y + 40, group.width - 50),
            fontSize: 12,
          },
        ]
      : []),
  ]);
  for (const [i, edge] of layout.edges.entries()) {
    const [x, y] = edge.points[0]!;
    elements.push({
      ...base(
        'edge-' + i,
        'arrow',
        x!,
        y!,
        Math.max(...edge.points.map((p) => p[0]!)) - Math.min(...edge.points.map((p) => p[0]!)),
        Math.max(...edge.points.map((p) => p[1]!)) - Math.min(...edge.points.map((p) => p[1]!)),
      ),
      points: edge.points.map((p) => [p[0]! - x!, p[1]! - y!]),
      startBinding: null,
      endBinding: null,
      lastCommittedPoint: null,
      startArrowhead: edge.bidirectional ? 'arrow' : null,
      endArrowhead: 'arrow',
      elbowed: false,
      strokeStyle: edge.from === 'operator' ? 'dashed' : 'solid',
    });
    elements.push(
      text(
        'edge-label-' + i,
        edge.label,
        edge.labelPosition[0]! - edge.label.length * 4,
        edge.labelPosition[1]! - 16,
      ),
    );
  }
  for (const node of layout.nodes) {
    elements.push({
      ...base(node.id, 'rectangle', node.x, node.y, layout.nodeWidth, layout.nodeHeight),
      backgroundColor: '#ffffff',
      roundness: { type: 3 },
    });
    elements.push(text(node.id + '-name', node.name, node.x + 12, node.y + 43));
    elements.push({
      ...text(node.id + '-stack', node.stack, node.x + 12, node.y + 73),
      fontSize: 13,
    });
    // Wrap the fixed purpose statement for the same readable card size as the live console.
    const lines =
      node.value
        .match(/.{1,30}(?:\s|$)|\S+/g)
        ?.map((line) => line.trim())
        .join('\n') ?? node.value;
    elements.push({
      ...text(node.id + '-value', lines, node.x + 12, node.y + 98, 210),
      fontSize: 12,
      height: 45,
    });
    if (node.icon) {
      const svg = fs.readFileSync(
        new URL(`../docs/diagrams/icons/${node.icon}.svg`, import.meta.url),
      );
      files[node.icon] = {
        id: node.icon,
        mimeType: 'image/svg+xml',
        dataURL: 'data:image/svg+xml;base64,' + svg.toString('base64'),
        created: 1,
      };
      elements.push({
        ...base(node.id + '-icon', 'image', node.x + 12, node.y + 10, 24, 24),
        fileId: node.icon,
        status: 'saved',
        scale: [1, 1],
        crop: null,
      });
    }
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: { viewBackgroundColor: '#f5f7fb', gridSize: null },
    files,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(
    new URL('../docs/diagrams/08-backend-console.excalidraw', import.meta.url),
    JSON.stringify(backendDiagram(), null, 2) + '\n',
  );
  console.log('Generated static backend scene; live evidence remains in the operator console.');
}
