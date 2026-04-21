#pragma once
// dit-sampler.h — HOT-Step redirect
//
// This file redirects to hot-step-sampler.h which contains our
// solver/scheduler/guidance plugin dispatch loop.
//
// The upstream vanilla dit-sampler.h is NOT used directly.
// On upstream sync, copy the upstream version to _upstream_dit-sampler.h
// for reference, then port any relevant fixes to hot-step-sampler.h.

#include "hot-step-sampler.h"
