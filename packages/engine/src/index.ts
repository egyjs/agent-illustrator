import pkg from '../package.json' with { type: 'json' };

export const ENGINE_VERSION: string = pkg.version;

export { closest, EngineError, type ErrorCode, type ErrorInfo } from './errors.ts';
export type { Box, FillRule, Mat6, Seg, Subpath, Vec2 } from './geometry/types.ts';
export {
  createDocument,
  integrityProblem,
  validateDocument,
  type BlendMode,
  type Canvas,
  type CreateDocumentInput,
  type Def,
  type Doc,
  type FilterDef,
  type FontSpec,
  type GradientStop,
  type GroupNode,
  type LinearGradientDef,
  type MaskFade,
  type PathNode,
  type RadialGradientDef,
  type SceneNode,
  type Style,
  type TextNode,
} from './scene/model.ts';
export { contrastRatio, HARMONIES, makePalette, type Harmony } from './scene/color.ts';
export { worldBounds, worldTransform } from './scene/query.ts';
export { DocumentStore } from './scene/store.ts';
export {
  DEFAULT_LIMITS,
  defineOp,
  executeBatch,
  Registry,
  type BatchOptions,
  type BatchResult,
  type Limits,
  type OpCall,
  type OpDef,
  type OpOutcome,
  type OpResult,
  type Warning,
} from './ops/registry.ts';
export { createRegistry } from './ops/index.ts';
export { toSvg, type SvgOptions } from './render/svg.ts';
export { MAX_RENDER_PIXELS, MAX_SCALE, rasterize, type Overlay, type Raster, type RasterFonts, type RasterOptions } from './render/raster.ts';
export { exportSvg, type ExportOptions } from './render/export.ts';
