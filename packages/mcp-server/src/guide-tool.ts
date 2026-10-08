import { closest, EngineError, type OpDef, type Registry } from '@agent-illustrator/engine';
import { z } from 'zod';
import { markdownTitle, yamlScalar, type AgentKit } from './agent-kit.ts';
import { guarded, opSignature, parse, text, type ToolDeps, type ToolResult } from './tools.ts';

export const guideInput = z.object({
  topic: z
    .string()
    .max(200)
    .optional()
    .describe('What to read: "workflow", a guide name, "ops", "op:<name>", "presets", "preset:<name>" or "text-only"; omit for the index'),
});

export const illustrateArgs = z.object({
  brief: z.string().describe('What to draw: subject, canvas size, mood, palette'),
  style: z.string().optional().describe('A style preset name; the guide tool lists them under "presets"'),
  vision: z.enum(['yes', 'no']).optional().describe('"no" if you cannot look at images: work from describe_scene, measure and lint instead of render'),
});

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  required?: string[];
  pattern?: string;
  default?: unknown;
  description?: string;
};
type Field = { name: string; optional: boolean; schema: JsonSchema };

/** How an object type is shown: whole down to this depth, then just `object`. */
const OBJECT_DEPTH = 2;

/** A compact type, e.g. `number | "N%"`, `"nonzero" | "evenodd"`, `[number, number][]`, `{ fill?: string }`. */
function typeOf(s: JsonSchema, depth = 0): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  const alternatives = s.anyOf ?? s.oneOf;
  if (alternatives) return [...new Set(alternatives.map((a) => typeOf(a, depth)))].join(' | ');
  if (s.prefixItems) return `[${s.prefixItems.map((i) => typeOf(i, depth)).join(', ')}]`;
  if (s.type === 'array') {
    const item = s.items ? typeOf(s.items, depth) : 'unknown';
    return `${item.includes(' | ') ? `(${item})` : item}[]`;
  }
  if (s.type === 'object') {
    if (s.properties === undefined) return typeof s.additionalProperties === 'object' ? `Record<string, ${typeOf(s.additionalProperties, depth)}>` : 'object';
    if (depth >= OBJECT_DEPTH) return 'object';
    const fields = Object.entries(s.properties).map(([name, v]) => `${name}${s.required?.includes(name) ? '' : '?'}: ${typeOf(v, depth + 1)}`);
    return `{ ${fields.join(', ')} }`;
  }
  if (s.type === 'string' && s.pattern?.endsWith('%$')) return '"N%"'; // the engine's Length: a number or a percent string
  return s.type ?? 'unknown';
}

/** An op's input fields, required first, each group in schema order (the order of the apply_ops signatures). */
function fieldsOf(def: OpDef): Field[] {
  const schema = z.toJSONSchema(def.schema, { io: 'input' }) as JsonSchema;
  const required = new Set(schema.required);
  const fields = Object.entries(schema.properties ?? {}).map(([name, s]) => ({ name, optional: !required.has(name), schema: s }));
  return [...fields.filter((f) => !f.optional), ...fields.filter((f) => f.optional)];
}

const firstSentence = (s: string) => /^.*?[.!?](?=\s|$)/s.exec(s)?.[0] ?? s;
const entry = (topic: string, description: string) => (description === '' ? topic : `${topic} - ${description}`);

function opCatalog(registry: Registry): string {
  const sections = [...Map.groupBy(registry.list(), (def) => def.domain)].map(
    ([domain, defs]) => `## ${domain}\n${defs.map((def) => entry(opSignature(def), firstSentence(def.description))).join('\n')}`,
  );
  return ['Ops by domain. A trailing ? marks an optional field; guide topic "op:<name>" shows one op in full.', ...sections].join('\n\n');
}

function opDetail(def: OpDef): string {
  const fields = fieldsOf(def).map(({ name, optional, schema }) => {
    const type = `${name}${optional ? '?' : ''}: ${typeOf(schema)}`;
    return `- ${type}${schema.default === undefined ? '' : ` = ${JSON.stringify(schema.default)}`}${schema.description ? ` - ${schema.description}` : ''}`;
  });
  const examples = def.examples.map((batch) => JSON.stringify(batch));
  return [
    `${def.name} (${def.domain})\n${def.description}`,
    `Fields (? marks optional):\n${fields.join('\n')}`,
    `Examples, each a complete apply_ops batch:\n${examples.join('\n')}`,
  ].join('\n\n');
}

function presetList(kit: AgentKit): string {
  const presets = [...kit.presets].map(([name, yaml]) => entry(name, yamlScalar(yaml, 'description')));
  return ['Style presets. Guide topic "preset:<name>" returns one as YAML.', ...presets].join('\n');
}

function index(kit: AgentKit): string {
  const files = [...kit.guides, ...kit.overlays].map(([name, markdown]) => entry(name, markdownTitle(markdown)));
  return [
    'Topics (pass one as `topic`):',
    ...files,
    'ops - every op by domain with its signature',
    'op:<name> - one op in full: fields, defaults, examples',
    ...(kit.presets.size === 0 ? [] : ['presets - the style presets', 'preset:<name> - one style preset as YAML']),
  ].join('\n');
}

/** Everything `topic` can be, for suggestions. */
function topicNames(registry: Registry, kit: AgentKit): string[] {
  return [
    ...kit.guides.keys(),
    ...kit.overlays.keys(),
    'ops',
    'presets',
    ...registry.names().map((name) => `op:${name}`),
    ...[...kit.presets.keys()].map((name) => `preset:${name}`),
  ];
}

function topicText(registry: Registry, kit: AgentKit, topic: string): string | undefined {
  if (topic === '') return index(kit);
  if (topic === 'ops') return opCatalog(registry);
  if (topic === 'presets') return presetList(kit);
  if (topic.startsWith('op:')) {
    const def = registry.get(topic.slice('op:'.length));
    return def && opDetail(def);
  }
  if (topic.startsWith('preset:')) return kit.presets.get(topic.slice('preset:'.length));
  return kit.guides.get(topic) ?? kit.overlays.get(topic);
}

export function guideTool(deps: ToolDeps, kit: AgentKit, raw: unknown): ToolResult {
  return guarded(deps, 'guide', () => {
    const input = parse(guideInput, raw, 'guide', { topic: 'workflow' });
    const topic = (input.topic ?? '').trim().toLowerCase();
    const body = topicText(deps.registry, kit, topic);
    if (body === undefined) {
      const near = closest(topic, topicNames(deps.registry, kit)).map((name) => `"${name}"`);
      throw new EngineError('invalid_input', `guide: unknown topic "${input.topic}"`, `${near.length > 0 ? `Did you mean ${near.join(', ')}?\n\n` : ''}${index(kit)}`);
    }
    return { content: [text(body)] };
  });
}

/** The `illustrate` prompt: `template` (prompts/illustrate.md) with {{brief}}, {{preset}} and {{overlay}} filled in. */
export function illustratePrompt(kit: AgentKit, template: string, args: z.output<typeof illustrateArgs>) {
  const preset = args.style === undefined ? 'none' : kit.presets.get(args.style);
  if (preset === undefined) {
    throw new EngineError('invalid_input', `illustrate: unknown style "${args.style}"; presets: ${[...kit.presets.keys()].join(', ')}`, 'Omit style, or use one of the listed presets.');
  }
  const values: Record<string, string> = { brief: args.brief, preset, overlay: args.vision === 'no' ? (kit.overlays.get('text-only') ?? '') : '' };
  const filled = template.replace(/\{\{(brief|preset|overlay)\}\}/g, (_, key: string) => values[key]!);
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: filled } }] };
}
