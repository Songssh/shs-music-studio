#pragma once
// guidance-registry.h: Compile-time registry mapping guidance mode names to functions
//
// Usage:
//   const GuidanceInfo* info = guidance_lookup("dynamic_cfg");
//   if (info) info->fn(pred_cond, pred_uncond, scale, mbuf, result, Oc, T, ctx);

#include "guidance-interface.h"
#include "guidance-implementations.h"

#include <cstring>

struct GuidanceInfo {
    const char *  name;          // internal identifier (lowercase)
    const char *  display_name;  // human-readable name for UI
    GuidanceFn    fn;            // guidance function pointer
    const char *  description;   // short description
};

// All registered guidance modes.
static const GuidanceInfo GUIDANCE_REGISTRY[] = {
    {"apg",           "APG",           guidance_apg,           "Adaptive perpendicular guidance (default)"},
    {"cfg_pp",        "CFG++",         guidance_cfg_pp,        "Step-scaled guidance for few-step"},
    {"dynamic_cfg",   "Dynamic CFG",   guidance_dynamic_cfg,   "Cosine-decaying guidance schedule"},
    {"rescaled_cfg",  "Rescaled CFG",  guidance_rescaled_cfg,  "Std-matched to prevent saturation"},
};

static const int GUIDANCE_REGISTRY_SIZE = (int) (sizeof(GUIDANCE_REGISTRY) / sizeof(GUIDANCE_REGISTRY[0]));

// Look up a guidance mode by name. Returns nullptr if not found.
static const GuidanceInfo * guidance_lookup(const char * name) {
    if (!name || !name[0]) return &GUIDANCE_REGISTRY[0]; // default: apg

    for (int i = 0; i < GUIDANCE_REGISTRY_SIZE; i++) {
        if (strcmp(GUIDANCE_REGISTRY[i].name, name) == 0) {
            return &GUIDANCE_REGISTRY[i];
        }
    }
    return nullptr;
}
