#pragma once
// solver-rfsolver.h: RF-Solver (2nd order, 2 NFE per step)
//
// From "Taming Rectified Flow for Inversion and Editing" (arXiv:2411.04746).
// A training-free sampler that exploits the rectified flow ODE structure
// (variation of constants + 2nd-order Taylor expansion) to reduce per-step
// error from O(h²) to O(h³).
//
// Algorithm (adapted to our t=1→0 convention):
//   Given v_t = model(xt, t_curr):
//   1. Half-step:    x_mid = xt - v_t * (dt/2)
//   2. Midpoint eval: v_mid = model(x_mid, t_mid)
//   3. Derivative:   v' ≈ (v_mid - v_t) / (dt/2)
//   4. RF-corrected: x_next = r*xt + (1-r)*v_t + C*v'
//      where r = t_prev/t_curr
//            C = (t_prev - t_curr) + t_prev * ln(t_prev/t_curr)
//
// When t_curr is very small, r→0 and C→0, reducing to x_next ≈ v_t.
// This is equivalent to Heun-class cost (2 NFE) but specifically derived
// for the rectified flow ODE, yielding better accuracy for flow-matching.

#include "solver-interface.h"
#include <cmath>

static void solver_rfsolver_step(float *       xt,
                                 const float * vt,
                                 float         t_curr,
                                 float         t_prev,
                                 int           n,
                                 SolverState & state,
                                 SolverModelFn model_fn,
                                 float *       vt_buf) {
    float dt = t_curr - t_prev;  // positive (stepping toward 0)

    if (!model_fn || t_curr < 1e-8f) {
        // Fallback to Euler if no model callback or degenerate timestep
        for (int i = 0; i < n; i++) {
            xt[i] -= vt[i] * dt;
        }
        return;
    }

    // Ensure scratch buffer is allocated
    if ((int) state.xt_scratch.size() < n) {
        state.xt_scratch.resize(n);
    }
    float * x_mid = state.xt_scratch.data();

    // Save k1 — vt and vt_buf alias the same memory, so model_fn will
    // overwrite when it writes the midpoint result.
    if ((int) state.prev_vt.size() < n) {
        state.prev_vt.resize(n);
    }
    memcpy(state.prev_vt.data(), vt, n * sizeof(float));
    const float * v_t = state.prev_vt.data();

    // ── Step 1: Euler half-step to midpoint ──
    float half_dt = dt * 0.5f;
    float t_mid   = t_curr - half_dt;
    for (int i = 0; i < n; i++) {
        x_mid[i] = xt[i] - v_t[i] * half_dt;
    }

    // ── Step 2: Evaluate velocity at midpoint ──
    model_fn(x_mid, t_mid);
    // Result is now in vt_buf (= v_mid)

    // ── Step 3: RF-specific correction coefficients ──
    float r = t_prev / t_curr;                            // ratio
    float log_r = logf(t_prev / t_curr);                  // ln(t_prev/t_curr), negative
    float C = (t_prev - t_curr) + t_prev * log_r;         // correction coefficient
    // C = -dt + t_prev * ln(t_prev/t_curr)
    // For small dt relative to t_curr, C ≈ -dt²/(2*t_curr), giving O(h³) correction

    // v' ≈ (v_mid - v_t) / (dt/2)
    // Substituting into x_next = r*xt + (1-r)*v_t + C*v':
    //   x_next = r*xt + (1-r)*v_t + (C/half_dt) * (v_mid - v_t)
    float C_over_h = C / half_dt;  // safe: half_dt > 0 since dt > 0

    // ── Step 4: Apply RF-corrected update ──
    for (int i = 0; i < n; i++) {
        float v_prime_term = C_over_h * (vt_buf[i] - v_t[i]);
        xt[i] = r * xt[i] + (1.0f - r) * v_t[i] + v_prime_term;
    }
}
