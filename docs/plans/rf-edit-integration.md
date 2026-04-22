# RF-Edit Integration Plan (Future)

> **Status**: Research / Future Work  
> **Paper**: [Taming Rectified Flow for Inversion and Editing](https://arxiv.org/html/2411.04746v1) (arXiv:2411.04746)  
> **Code**: https://github.com/wangjiangshan0725/RF-Solver-Edit  
> **Prerequisite**: RF-Solver (implemented as `solver-rfsolver.h`)

---

## What RF-Edit Does

RF-Edit enables **editing existing audio** by:
1. **Inverting** a source audio's latent representation back to noise space using RF-Solver (running the ODE in reverse)
2. **Re-generating** from that noise with a modified prompt/conditioning
3. **Preserving structure** of the original by sharing self-attention Value features from the inversion pass into the denoising pass

This maps directly to our planned-but-unported features:
- **Cover Mode** — take existing audio, invert to noise, re-generate with different style/lyrics
- **Repaint Mode** — invert, mask specific time regions, re-denoise only those regions
- **Lego/Extract/Complete** — partial inversion + conditional re-generation

## Key Technical Components

### 1. RF-Solver Inversion (Reverse ODE)

The inversion process runs RF-Solver in reverse — from clean audio latent (t=0) back to noise (t=1):

```
Z̃_{t_{i+1}} = (t_{i+1}/t_i) * Z̃_{t_i} + (1 - t_{i+1}/t_i) * v̂ + C_inv * v'
```

Where C_inv uses the same log-ratio correction but with reversed timestep direction.

**Implementation note**: This requires a second entry point in the sampler that runs the schedule backwards (0→1 instead of 1→0). The solver itself is symmetric.

### 2. Self-Attention Value Sharing (Structure Preservation)

During inversion, at the last `n` timesteps, extract and store the **Value (V)** features from self-attention layers in the last M transformer blocks.

During denoising with the new prompt, replace V in the corresponding layers/timesteps with the stored V from inversion:

```
F'_{t_k} = softmax(Q_{t_k} @ K_{t_k}^T / √d) @ Ṽ_{t_k}   (V from inversion)
```

This preserves the structural/spatial information while allowing the new prompt to guide content.

**Implementation considerations for ACE-Step DiT:**
- ACE-Step's DiT has 24 transformer layers with self-attention + cross-attention
- We'd need to identify which layers capture "structural" vs "content" information for audio
- The paper shares V in the last M single blocks (FLUX) / spatial attention (OpenSora)
- For audio DiT: likely self-attention layers, but this needs experimentation
- VRAM impact: storing V features for M layers × n timesteps × batch could be significant

### 3. Feature Sharing Schedule

The paper finds 5 sharing steps works well for most images. For audio:
- Too many sharing steps → edited output too similar to source (defeats the purpose)
- Too few → structural coherence lost
- Will need audio-specific tuning, likely different from the image domain

## Architecture Sketch

```
                     ┌─────────────────────────────┐
                     │     Cover/Edit Pipeline      │
                     └─────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             ┌──────────┐  ┌────────────┐  ┌──────────┐
             │ Encode    │  │ Inversion  │  │ Re-Denoise│
             │ Source    │  │ (RF-Solver │  │ (RF-Solver│
             │ via VAE   │  │  reverse)  │  │  forward) │
             │ Encoder   │  │ Store V's  │  │ Inject V's│
             └──────────┘  └────────────┘  └──────────┘
                 │               │              │
                 ▼               ▼              ▼
             latent_0 ──→ noise_inv ──→ edited_latent_0
                                         │
                                    VAE Decode
                                         │
                                    edited_audio
```

## Required Engine Changes

### New/Modified Files

| File | Changes |
|------|---------|
| `hot-step-sampler.h` | Add `dit_ggml_invert()` function running schedule backwards |
| `dit.h` / `dit-graph.h` | Expose V tensors from self-attention layers for extraction |
| `solver-rfsolver.h` | Already done — inversion uses same solver in reverse |
| `pipeline-synth-impl.h` | Add cover/edit mode orchestration |
| `request.h` | Parse cover/edit parameters from JSON request |
| `vae-enc.h` | VAE encoder for source audio → latent (already exists) |

### V Feature Storage

```cpp
struct InversionCache {
    int n_sharing_steps;      // how many timesteps to share
    int n_sharing_layers;     // how many DiT layers (from the end)
    // V features: [n_sharing_steps][n_sharing_layers][seq_len * head_dim]
    std::vector<std::vector<std::vector<float>>> v_cache;
};
```

### VRAM Estimate

Per V tensor: `seq_len × head_dim × sizeof(float)`
- seq_len ≈ 512 (for typical audio length)
- head_dim = 128 (typical for ACE-Step DiT)
- Per layer per step: 512 × 128 × 4 = 256 KB
- For 6 layers × 5 steps: ~7.5 MB — negligible

## Open Questions

1. **Which DiT layers to share V from?** Paper uses "last M blocks" — for audio we may need different selection (e.g., skip cross-attention layers entirely)
2. **Optimal sharing steps for audio?** 5 works for images; audio temporal structure is fundamentally different
3. **How does this interact with our guidance modes (APG, CFG++)?** CFG needs both cond/uncond V features — share both or only cond?
4. **Can we share V during batch CFG (2N graph)?** Memory layout implications
5. **Does RF-Edit compose with our existing repaint injection?** Repaint already does partial-region replacement; RF-Edit would be a higher-quality alternative

## References

- Paper: https://arxiv.org/abs/2411.04746
- Code: https://github.com/wangjiangshan0725/RF-Solver-Edit
- RF-Inversion (simpler predecessor): https://arxiv.org/abs/2410.10792
- Flow Matching theory: Liu et al. "Flow Straight and Fast" (arXiv:2209.03003)
