#import <Cocoa/Cocoa.h>
#include <node_api.h>

/**
 * MakeNonActivating:
 * Applies NSWindowStyleMaskNonactivatingPanel to an Electron BrowserWindow's native NSWindow.
 * 
 * On macOS, when a transparent overlay or desktop companion panel is clicked, macOS default
 * window layering policy activates the entire application, causing any other windows belonging
 * to the app (e.g. the Dashboard) to be brought forward in front of the user's active editor/browser.
 * 
 * By adding NSWindowStyleMaskNonactivatingPanel:
 * 1. Mouse clicks on the companion overlay are received directly by the renderer without activating
 *    the DeskPals application process at the macOS WindowServer level.
 * 2. The user's active application (VS Code, Chrome, etc.) remains key and active.
 * 3. The Dashboard window never jumps forward or flashes.
 */
static napi_value MakeNonActivating(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_status status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (status != napi_ok || argc < 1) {
    napi_value res;
    napi_get_boolean(env, false, &res);
    return res;
  }

  void* data = NULL;
  size_t length = 0;
  status = napi_get_buffer_info(env, args[0], &data, &length);
  if (status != napi_ok || !data || length < sizeof(void*)) {
    napi_value res;
    napi_get_boolean(env, false, &res);
    return res;
  }

  uintptr_t ptr = *reinterpret_cast<uintptr_t*>(data);
  if (!ptr) {
    napi_value res;
    napi_get_boolean(env, false, &res);
    return res;
  }

  NSView* view = (__bridge NSView*)(void*)ptr;
  if (!view || ![view isKindOfClass:[NSView class]]) {
    napi_value res;
    napi_get_boolean(env, false, &res);
    return res;
  }

  NSWindow* window = [view window];
  if (!window) {
    napi_value res;
    napi_get_boolean(env, false, &res);
    return res;
  }

  // 1. Add non-activating panel style mask
  window.styleMask |= NSWindowStyleMaskNonactivatingPanel;

  // 2. Prevent window from hiding when app deactivates
  [window setHidesOnDeactivate:NO];

  // 3. Configure NSPanel floating behavior
  if ([window isKindOfClass:[NSPanel class]]) {
    NSPanel* panel = (NSPanel*)window;
    [panel setFloatingPanel:YES];
    [panel setBecomesKeyOnlyIfNeeded:YES];
  }

  napi_value res;
  napi_get_boolean(env, true, &res);
  return res;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "makeNonActivating", NAPI_AUTO_LENGTH, MakeNonActivating, NULL, &fn);
  napi_set_named_property(env, exports, "makeNonActivating", fn);
  return exports;
}
