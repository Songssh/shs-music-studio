# Adapter Group Scales Investigation

**Date:** 2026-04-18  
**Status:** Root cause identified, fixes pending  
**Log analysed:** `logs/2026-04-18_12-55-10` (job `89d60c07`, adapter `greenday_saviors.safetensors`)

---

## Summary

Two independent bugs were found that together make adapter group scale sliders appear non-functional:

1. **Training-time alpha asymmetry** — LyCORIS LoKr silently forces `alpha=lora_dim` for monolithic modules but respects the config's `linear_alpha=1` for factorized modules (MLP), producing a **512× scaling gap** between attention and MLP groups.
2. **Python `_determine_group()` pattern bug** — The Python hot-step-9000 runtime uses wrong substring patterns (`.ff.`, `.attn.`) that don't match the ACE-Step model's actual naming (`mlp`, `self_attn`), causing self_attn and mlp to be misclassified as "unclassified" and receive an averaged group scale instead of their intended individual values.

The C++ engine has correct group detection patterns but faithfully applies the alpha=1 from the safetensors, exposing the training-time issue that the Python accidentally hid.

---

## Bug 1: LyCORIS Alpha Asymmetry (Training)

### Root Cause

LyCORIS `LokrModule.__init__()` decides **per module** whether to use monolithic or factorized `w2`:

```python
# lycoris/modules/lokr.py line 141
if lora_dim < max(shape[0][1], shape[1][1]) / 2 and not self.full_matrix:
    # FACTORIZED: w2 = w2_a @ w2_b
else:
    # MONOLITHIC: w2 is a single full matrix
```

For **monolithic** modules, LyCORIS then **overrides** the configured alpha:

```python
# line 186-188
if self.use_w2 and self.use_w1:
    alpha = lora_dim  # IGNORES config, forces alpha=512
```

The `scale` used in `make_kron()` is `alpha / lora_dim`.

### Effect on Adapters Trained with `linear_alpha=1, linear_dim=512`

| Module Group | w2 Type | Why | Stored Alpha | scale (α/dim) |
|---|---|---|---|---|
| self_attn (q/k/v/o_proj) | Monolithic | Dims too small for factorization | 512 (forced) | **1.0** |
| cross_attn (q/k/v/o_proj) | Monolithic | Dims too small for factorization | 512 (forced) | **1.0** |
| mlp (gate/up/down_proj) | Factorized | Large dims trigger `lora_dim < max/2` | 1 (from config) | **0.00195** |
| cond_embed | Monolithic | Single projection layer | 512 (forced) | **1.0** |

### Verified From Adapter File

```
greenday_saviors.safetensors — layer 0:
  cross_attn_k_proj: alpha=512, w1=[4,5], w2=[256,512]    (monolithic)
  self_attn_k_proj:  alpha=512, w1=[4,5], w2=[256,512]    (monolithic)
  mlp_down_proj:     alpha=1,   w2_a=[512,512], w2_b=[512,2432] (factorized)
  mlp_gate_proj:     alpha=1,   w2_a=[2432,512], w2_b=[512,512] (factorized)
```

Matches `sidestep_adapter_config.json`:
```json
{
  "linear_dim": 512,
  "linear_alpha": 1,    // ← only affects factorized modules (MLP)
  "factor": 6,
  "decompose_both": true
}
```

### Impact on Group Scale Sliders

With user settings `self_attn=0.4, cross_attn=0.4, mlp=4.0, cond_embed=1.0`:

| Group | α/rank | × g_scale | **Effective** |
|---|---|---|---|
| self_attn | 1.0 | × 0.40 | **0.4000** |
| cross_attn | 1.0 | × 0.40 | **0.4000** |
| **mlp** | **0.00195** | × 4.00 | **0.0078** ← effectively zero |
| cond_embed | 1.0 | × 1.00 | **1.0000** |

To get MLP on par with attn at effective=0.4, user would need `mlp_group_scale ≈ 205`.

### Fix (Training)

Change `linear_alpha` to match `linear_dim` in the adapter config:

```diff
- "linear_alpha": 1,
+ "linear_alpha": 512,
```

This gives factorized modules `scale = 512/512 = 1.0`, matching monolithic modules. The Prodigy optimizer adapts automatically, so training dynamics are unaffected.

**Note:** `decompose_both` is NOT the cause. The w2 factorization for MLP is gated by an independent size check, not by `decompose_both`. The `decompose_both` flag only controls whether w1 (the small 4×5 factor) can also be decomposed — and at rank 512, w1 is too small to decompose regardless.

### Fix (Side-Step Default)

TODO: Find where Side-Step sets the default `linear_alpha=1` and change it to default to `linear_dim`. This prevents future adapters from having the asymmetry.

---

## Bug 2: Python `_determine_group()` Pattern Mismatch

### Root Cause

`_determine_group()` in `hot-step-9000/acestep/core/generation/handler/lora/advanced_adapter_mixin.py` line 139:

```python
def _determine_group(module_name: str) -> str:
    if "cross_attn" in module_name:        return "cross_attn"   # ✅
    elif ".attn." in module_name or ".attn_" in module_name:
                                            return "self_attn"    # ❌ WRONG PATTERN
    elif ".ff." in module_name or ".ff_" in module_name:
                                            return "mlp"          # ❌ WRONG PATTERN
    elif "condition_embed" in module_name:  return "cond_embed"   # ✅
    return ""
```

The ACE-Step model uses `self.self_attn` and `self.mlp` in its transformer blocks, producing state_dict keys like:
- `layers.0.self_attn.q_proj.weight` — contains `_attn.` not `.attn.` → **no match**
- `layers.0.mlp.gate_proj.weight` — contains `.mlp.` not `.ff.` → **no match**

### Empirically Verified

```python
>>> _determine_group("layers.0.self_attn.q_proj.weight")
''   # should be "self_attn"!

>>> _determine_group("layers.0.mlp.gate_proj.weight")
''   # should be "mlp"!
```

### Why Users Didn't Notice

Unclassified tensors (group `""`) receive the **average** of all 4 group scales:

```python
# line 661
vals = [gs.get("self_attn", 1.0), gs.get("cross_attn", 1.0),
        gs.get("mlp", 1.0), gs.get("cond_embed", 1.0)]
g_scale = sum(vals) / len(vals)
```

With `self_attn=0.4, cross_attn=0.4, mlp=4.0, cond_embed=1.0`:
- Average = `(0.4 + 0.4 + 4.0 + 1.0) / 4 = 1.45`
- **Both** self_attn and mlp tensors get `g_scale = 1.45`
- Changing the MLP slider moves the self_attn effective scale (which is audible), creating the illusion that MLP control is working

### Fix (Python)

```python
def _determine_group(module_name: str) -> str:
    if "cross_attn" in module_name:    return "cross_attn"
    elif "self_attn" in module_name:   return "self_attn"   # fixed
    elif ".mlp." in module_name:       return "mlp"         # fixed
    elif "condition_embed" in module_name: return "cond_embed"
    return ""
```

### C++ Already Correct

`adapter-merge.h` line 63-69 uses the correct patterns:

```cpp
if (gguf_name.find(".cross_attn.") != std::string::npos) return "cross_attn";
if (gguf_name.find(".self_attn.")  != std::string::npos) return "self_attn";
if (gguf_name.find(".mlp.")        != std::string::npos) return "mlp";
if (gguf_name.find("condition_embedder") != std::string::npos) return "cond_embed";
```

---

## Additional Observations

### Shape Mismatch on proj_in

```
[Adapter] WARNING: LoKr shape mismatch for decoder.proj_in.1.weight:
  kron(5x6, 512x32) = 2560x192 vs GGUF out=192 in=2
```

One tensor (`proj_in.1`) was skipped due to GGUF dimension mismatch. The expected kron product is 2560×192 but GGUF has the tensor as 192×2. This may be a GGUF conversion issue or a model architecture difference. Impact unclear — this is a projection-in layer.

### Unclassified Tensors

Tensors not matching any group (e.g., `time_embed`, `time_proj`, norms, `scale_shift_table`) receive the average of all group scales. With the test settings this gives `g_scale=1.45`.

For `time_proj` tensors: alpha=1, rank=512 → effective = `0.0028` (same alpha=1 issue as MLP).

---

## Action Items

### Must Fix

- [ ] **Side-Step training config**: Change default `linear_alpha` to match `linear_dim` (or set it to `0` which LyCORIS interprets as `lora_dim`)
- [ ] **Python `_determine_group()`**: Fix patterns from `.attn.`/`.ff.` to `self_attn`/`.mlp.`
- [ ] **Re-train adapters** with corrected `linear_alpha=512` for proper MLP group scale control

### Should Fix

- [ ] **C++ engine**: Consider normalizing group scales by alpha/rank so existing adapters' sliders are usable without requiring extreme values
- [ ] **UI**: Display effective scale per group (after alpha/rank normalization) so users see the actual contribution strength
- [ ] **Side-Step UI tooltip**: Update "linear_alpha" tooltip to explain the monolithic override and the factorization-dependent behavior more clearly

### Investigate

- [ ] `proj_in.1` shape mismatch — is this a GGUF conversion bug or expected?
- [ ] `time_embed`/`time_proj` alpha=1 — same issue as MLP, are these adapted tensors important for quality?
- [ ] Whether `full_matrix=true` (forcing all monolithic) would be a better default for LoKr on ACE-Step, trading adapter size for uniform slider behavior

---

## Reference Files

| File | Location |
|------|----------|
| C++ group detection | `engine/src/adapter-merge.h:63-69` |
| C++ LoKr merge | `engine/src/adapter-merge.h:800-980` |
| Python group detection | `hot-step-9000/.../advanced_adapter_mixin.py:139-156` |
| Python group merge | `hot-step-9000/.../advanced_adapter_mixin.py:620-694` |
| LyCORIS alpha override | `lycoris/modules/lokr.py:186-194` |
| LyCORIS factorization test | `lycoris/modules/lokr.py:141` |
| Side-Step adapter config | `Side-Step/trained_adapters/.../sidestep_adapter_config.json` |
| Engine log analysed | `logs/2026-04-18_12-55-10/ace_engine.log` |
| Generation log analysed | `logs/2026-04-18_12-55-10/generations/gen_89d60c07-*.log` |
