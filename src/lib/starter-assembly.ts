import {
  createInitialState,
  getPlacements,
  setBedding,
  setPlatformPool,
  tryPlace,
  validateAssembly,
  type ActionResult,
  type AssemblyState,
  type PlaceResult,
} from "./assembly";
import { applyColorStyle } from "./color-styles";

function requireState(result: ActionResult): AssemblyState {
  if (!result.ok) throw new Error(`初始搭配无法创建：${result.reason}`);
  return result.state;
}

/** Select the intended supporting surface through the same magnetic rules as editing. */
function placeOnParent(state: AssemblyState, productId: string, parentId: string): Extract<PlaceResult, { ok: true }> {
  const placement = getPlacements(state, productId).find(candidate => candidate.parentId === parentId);
  if (!placement) throw new Error(`初始搭配缺少可用磁吸位：${productId}`);
  const result = tryPlace(state, productId, placement, placement.rotation);
  if (!result.ok) throw new Error(`初始搭配无法创建：${result.reason}`);
  return result;
}

/** Only used when there is no saved design; the bare-platform reset stays separate. */
export function createNewUserState(): AssemblyState {
  let state = requireState(setBedding(createInitialState(), { mode: "none", depth: 0 }));
  state = requireState(setPlatformPool(state, "base", true));
  const villa = placeOnParent(state, "villa", "base");
  const hat = placeOnParent(villa.state, "roof-cottage", villa.item.id);
  const planter = placeOnParent(hat.state, "planter", villa.item.id);
  return validateAssembly(applyColorStyle(planter.state, 0));
}
