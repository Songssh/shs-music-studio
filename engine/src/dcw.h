#pragma once
// dcw.h: Differential Correction in Wavelet domain (DCW)
//
// Training-free sampler-side quality enhancer based on:
//   "Elucidating the SNR-t Bias of Diffusion Probabilistic Models"
//   Yu, Sun, Zeng, Chu, Zhan — CVPR 2026 (arXiv:2604.16044)
//   https://github.com/AMAP-ML/DCW
//
// Decomposes the denoising latent into frequency bands via 1-D Haar DWT,
// applies per-band differential correction, then reconstructs.
// Counteracts the SNR-t drift that accumulates during reverse-process inference.
//
// Operates on flat [N * T * Oc] audio latents where:
//   N  = batch size
//   T  = temporal frames (25 Hz latent rate)
//   Oc = latent channels (64 for ACE-Step)
// DWT is applied along the T axis independently per (batch, channel) pair.

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

static constexpr float HAAR_NORM = 0.70710678118f; // 1/sqrt(2)

// ── 1-D Haar Discrete Wavelet Transform ──────────────────────────────────
// Forward: decomposes signal of even length into low-freq and high-freq halves.
//   low[i]  = (in[2i] + in[2i+1]) / sqrt(2)
//   high[i] = (in[2i] - in[2i+1]) / sqrt(2)
static inline void haar_dwt_1d(const float * in, float * low, float * high, int len) {
    const int half = len / 2;
    for (int i = 0; i < half; i++) {
        float a = in[2 * i];
        float b = in[2 * i + 1];
        low[i]  = (a + b) * HAAR_NORM;
        high[i] = (a - b) * HAAR_NORM;
    }
}

// Inverse: reconstructs signal from low-freq and high-freq halves.
//   out[2i]   = (low[i] + high[i]) / sqrt(2)
//   out[2i+1] = (low[i] - high[i]) / sqrt(2)
static inline void haar_idwt_1d(const float * low, const float * high, float * out, int len) {
    const int half = len / 2;
    for (int i = 0; i < half; i++) {
        float l = low[i];
        float h = high[i];
        out[2 * i]     = (l + h) * HAAR_NORM;
        out[2 * i + 1] = (l - h) * HAAR_NORM;
    }
}

// ── DCW Correction Functions ─────────────────────────────────────────────
// These operate on flat [N * T * Oc] latents, applying Haar DWT along T.
// For each (batch, channel), we extract T values at stride Oc, transform,
// correct, inverse-transform, and write back.

// Pixel-space correction (Eq. 17 from the paper — no wavelets):
//   x_next[i] += scaler * (x_next[i] - denoised[i])
static inline void dcw_correct_pix(float * x_next, const float * denoised,
                                    float scaler, int n_total) {
    for (int i = 0; i < n_total; i++) {
        x_next[i] += scaler * (x_next[i] - denoised[i]);
    }
}

// Low-frequency wavelet correction (Eq. 18/20):
// Correct only the low-frequency (approximation) coefficients.
static inline void dcw_correct_low(float * x_next, const float * denoised,
                                    float scaler, int T, int Oc, int N) {
    if (T < 2) return; // need at least 2 frames for DWT
    const int T_even = (T / 2) * 2; // round down to even
    const int half_T = T_even / 2;

    // Scratch buffers for one (batch, channel) 1-D signal
    std::vector<float> sig_x(T_even), sig_y(T_even);
    std::vector<float> xl(half_T), xh(half_T), yl(half_T);
    std::vector<float> out(T_even);

    for (int b = 0; b < N; b++) {
        for (int ch = 0; ch < Oc; ch++) {
            // Extract T values at stride Oc for this (batch, channel)
            const int base = b * T * Oc + ch;
            for (int t = 0; t < T_even; t++) {
                sig_x[t] = x_next[base + t * Oc];
                sig_y[t] = denoised[base + t * Oc];
            }

            // Forward DWT
            haar_dwt_1d(sig_x.data(), xl.data(), xh.data(), T_even);
            // We only need yl for low-freq correction, but haar_dwt_1d requires valid pointers.
            std::vector<float> yh_tmp(half_T);
            haar_dwt_1d(sig_y.data(), yl.data(), yh_tmp.data(), T_even);

            // Correct low-frequency band
            for (int i = 0; i < half_T; i++) {
                xl[i] += scaler * (xl[i] - yl[i]);
            }

            // Inverse DWT (keep original high-freq)
            haar_idwt_1d(xl.data(), xh.data(), out.data(), T_even);

            // Write back
            for (int t = 0; t < T_even; t++) {
                x_next[base + t * Oc] = out[t];
            }
        }
    }
}

// High-frequency wavelet correction:
// Correct only the high-frequency (detail) coefficients.
static inline void dcw_correct_high(float * x_next, const float * denoised,
                                     float scaler, int T, int Oc, int N) {
    if (T < 2) return;
    const int T_even = (T / 2) * 2;
    const int half_T = T_even / 2;

    std::vector<float> sig_x(T_even), sig_y(T_even);
    std::vector<float> xl(half_T), xh(half_T), yh(half_T);
    std::vector<float> yl_tmp(half_T);
    std::vector<float> out(T_even);

    for (int b = 0; b < N; b++) {
        for (int ch = 0; ch < Oc; ch++) {
            const int base = b * T * Oc + ch;
            for (int t = 0; t < T_even; t++) {
                sig_x[t] = x_next[base + t * Oc];
                sig_y[t] = denoised[base + t * Oc];
            }

            haar_dwt_1d(sig_x.data(), xl.data(), xh.data(), T_even);
            haar_dwt_1d(sig_y.data(), yl_tmp.data(), yh.data(), T_even);

            // Correct high-frequency band
            for (int i = 0; i < half_T; i++) {
                xh[i] += scaler * (xh[i] - yh[i]);
            }

            haar_idwt_1d(xl.data(), xh.data(), out.data(), T_even);

            for (int t = 0; t < T_even; t++) {
                x_next[base + t * Oc] = out[t];
            }
        }
    }
}

// Double correction: correct both low and high bands with independent scalers.
static inline void dcw_correct_double(float * x_next, const float * denoised,
                                       float low_scaler, float high_scaler,
                                       int T, int Oc, int N) {
    if (T < 2) return;
    const int T_even = (T / 2) * 2;
    const int half_T = T_even / 2;

    std::vector<float> sig_x(T_even), sig_y(T_even);
    std::vector<float> xl(half_T), xh(half_T), yl(half_T), yh(half_T);
    std::vector<float> out(T_even);

    for (int b = 0; b < N; b++) {
        for (int ch = 0; ch < Oc; ch++) {
            const int base = b * T * Oc + ch;
            for (int t = 0; t < T_even; t++) {
                sig_x[t] = x_next[base + t * Oc];
                sig_y[t] = denoised[base + t * Oc];
            }

            haar_dwt_1d(sig_x.data(), xl.data(), xh.data(), T_even);
            haar_dwt_1d(sig_y.data(), yl.data(), yh.data(), T_even);

            // Correct both bands
            for (int i = 0; i < half_T; i++) {
                xl[i] += low_scaler  * (xl[i] - yl[i]);
                xh[i] += high_scaler * (xh[i] - yh[i]);
            }

            haar_idwt_1d(xl.data(), xh.data(), out.data(), T_even);

            for (int t = 0; t < T_even; t++) {
                x_next[base + t * Oc] = out[t];
            }
        }
    }
}
