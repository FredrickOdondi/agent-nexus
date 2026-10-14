/**
 * macOS perception helper: display bounds in points, Apple Vision OCR, the
 * accessibility (AX) tree of the frontmost app, and an image renderer that
 * resizes, crops and draws numbered Set-of-Marks boxes.
 *
 * Objective-C rather than Swift for the same reason as the input helper:
 * Command Line Tools often ship a Swift compiler that rejects the Mac SDK.
 */
import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { commandExists, run, ScreenError } from "./screen-proc.js";

export const SEE_M = String.raw`
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <Vision/Vision.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ImageIO/ImageIO.h>
#import <CoreText/CoreText.h>

static void emit(id obj) {
  NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
  if (d) fwrite(d.bytes, 1, d.length, stdout);
  fputc('\n', stdout);
}

static CGImageRef load_image(const char *p) {
  NSURL *u = [NSURL fileURLWithPath:[NSString stringWithUTF8String:p]];
  CGImageSourceRef src = CGImageSourceCreateWithURL((__bridge CFURLRef)u, NULL);
  if (!src) return NULL;
  CGImageRef img = CGImageSourceCreateImageAtIndex(src, 0, NULL);
  CFRelease(src);
  return img;
}

static int cmd_bounds(void) {
  CGRect b = CGDisplayBounds(CGMainDisplayID());
  printf("%d %d %d %d\n", (int)b.origin.x, (int)b.origin.y, (int)b.size.width, (int)b.size.height);
  return 0;
}

static int cmd_ocr(const char *path, BOOL fast) {
  CGImageRef img = load_image(path);
  if (!img) { fputs("cannot read image\n", stderr); return 2; }
  VNRecognizeTextRequest *req = [[VNRecognizeTextRequest alloc] init];
  req.recognitionLevel = fast ? VNRequestTextRecognitionLevelFast : VNRequestTextRecognitionLevelAccurate;
  req.usesLanguageCorrection = YES;
  VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCGImage:img options:@{}];
  NSError *err = nil;
  [h performRequests:@[req] error:&err];
  CGImageRelease(img);
  if (err) { fprintf(stderr, "%s\n", err.localizedDescription.UTF8String); return 2; }
  NSMutableArray *out = [NSMutableArray array];
  for (VNRecognizedTextObservation *o in req.results) {
    VNRecognizedText *t = [[o topCandidates:1] firstObject];
    if (!t || t.string.length == 0) continue;
    CGRect r = o.boundingBox;
    [out addObject:@{
      @"text": t.string,
      @"c": @(t.confidence),
      @"x": @(r.origin.x),
      @"y": @(1.0 - r.origin.y - r.size.height),
      @"w": @(r.size.width),
      @"h": @(r.size.height)
    }];
  }
  emit(out);
  return 0;
}

static NSString *ax_string(AXUIElementRef el, CFStringRef attr) {
  CFTypeRef v = NULL;
  if (AXUIElementCopyAttributeValue(el, attr, &v) != kAXErrorSuccess || !v) return nil;
  NSString *s = nil;
  if (CFGetTypeID(v) == CFStringGetTypeID()) s = [(__bridge NSString *)v copy];
  else if (CFGetTypeID(v) == CFNumberGetTypeID()) s = [(__bridge NSNumber *)v stringValue];
  CFRelease(v);
  if (s.length > 240) s = [s substringToIndex:240];
  return s.length ? s : nil;
}

static BOOL ax_bool(AXUIElementRef el, CFStringRef attr, BOOL fallback) {
  CFTypeRef v = NULL;
  if (AXUIElementCopyAttributeValue(el, attr, &v) != kAXErrorSuccess || !v) return fallback;
  BOOL b = fallback;
  if (CFGetTypeID(v) == CFBooleanGetTypeID()) b = CFBooleanGetValue((CFBooleanRef)v);
  CFRelease(v);
  return b;
}

static BOOL ax_frame(AXUIElementRef el, CGRect *out) {
  CFTypeRef pv = NULL, sv = NULL;
  CGPoint p; CGSize s;
  if (AXUIElementCopyAttributeValue(el, kAXPositionAttribute, &pv) != kAXErrorSuccess || !pv) return NO;
  if (AXUIElementCopyAttributeValue(el, kAXSizeAttribute, &sv) != kAXErrorSuccess || !sv) { CFRelease(pv); return NO; }
  BOOL ok = AXValueGetValue((AXValueRef)pv, kAXValueCGPointType, &p) && AXValueGetValue((AXValueRef)sv, kAXValueCGSizeType, &s);
  CFRelease(pv); CFRelease(sv);
  if (ok) *out = CGRectMake(p.x, p.y, s.width, s.height);
  return ok;
}

static NSSet *interesting_roles(void) {
  static NSSet *set;
  if (!set) set = [NSSet setWithArray:@[
    @"AXButton", @"AXCheckBox", @"AXRadioButton", @"AXPopUpButton", @"AXMenuButton",
    @"AXComboBox", @"AXTextField", @"AXTextArea", @"AXSearchField", @"AXLink",
    @"AXMenuItem", @"AXMenuBarItem", @"AXTab", @"AXSlider", @"AXIncrementor",
    @"AXDisclosureTriangle", @"AXStaticText", @"AXHeading", @"AXImage", @"AXCell", @"AXSwitch",
    @"AXToggle", @"AXSegmentedControl", @"AXColorWell", @"AXDockItem"
  ]];
  return set;
}

static void ax_walk(AXUIElementRef el, int depth, int maxDepth, NSMutableArray *out, int *budget, CGRect clip) {
  if (depth > maxDepth || *budget <= 0) return;
  (*budget)--;
  NSString *role = ax_string(el, kAXRoleAttribute) ?: @"";
  CGRect f;
  BOOL hasFrame = ax_frame(el, &f);
  if (hasFrame && depth > 0 && (f.size.width < 2 || f.size.height < 2)) return;
  if (hasFrame && depth > 1 && !CGRectIntersectsRect(f, clip)) return;
  if (hasFrame && [interesting_roles() containsObject:role]) {
    NSString *label = ax_string(el, kAXTitleAttribute) ?: ax_string(el, kAXDescriptionAttribute);
    NSString *value = ax_string(el, kAXValueAttribute);
    NSString *placeholder = ax_string(el, CFSTR("AXPlaceholderValue"));
    NSString *subrole = ax_string(el, kAXSubroleAttribute);
    if (!label && [role isEqualToString:@"AXImage"]) label = nil;
    BOOL keep = label || value || placeholder || ![role isEqualToString:@"AXStaticText"];
    if ([role isEqualToString:@"AXImage"] || [role isEqualToString:@"AXCell"]) keep = label != nil || value != nil;
    if (keep) {
      NSMutableDictionary *d = [@{
        @"role": role,
        @"x": @(f.origin.x), @"y": @(f.origin.y), @"w": @(f.size.width), @"h": @(f.size.height),
        @"enabled": @(ax_bool(el, kAXEnabledAttribute, YES)),
        @"focused": @(ax_bool(el, kAXFocusedAttribute, NO))
      } mutableCopy];
      if (label) d[@"label"] = label;
      if (value) d[@"value"] = value;
      if (placeholder) d[@"placeholder"] = placeholder;
      if (subrole) d[@"subrole"] = subrole;
      [out addObject:d];
    }
    if ([role isEqualToString:@"AXStaticText"]) return;
  }
  CFTypeRef kids = NULL;
  if (AXUIElementCopyAttributeValue(el, kAXChildrenAttribute, &kids) != kAXErrorSuccess || !kids) return;
  if (CFGetTypeID(kids) == CFArrayGetTypeID()) {
    CFArrayRef arr = (CFArrayRef)kids;
    CFIndex n = CFArrayGetCount(arr);
    for (CFIndex i = 0; i < n && *budget > 0; i++) {
      ax_walk((AXUIElementRef)CFArrayGetValueAtIndex(arr, i), depth + 1, maxDepth, out, budget, clip);
    }
  }
  CFRelease(kids);
}

static int cmd_ax(int budgetArg) {
  if (!AXIsProcessTrusted()) {
    fputs("accessibility not allowed for this process\n", stderr);
    return 3;
  }
  NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
  if (!front) { emit(@{ @"elements": @[] }); return 0; }
  pid_t pid = front.processIdentifier;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 1.5);
  CGRect screen = CGDisplayBounds(CGMainDisplayID());
  NSMutableArray *els = [NSMutableArray array];
  int budget = budgetArg > 0 ? budgetArg : 4000;
  NSString *winTitle = nil;

  CFTypeRef win = NULL;
  if (AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &win) != kAXErrorSuccess || !win) {
    CFTypeRef wins = NULL;
    if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, &wins) == kAXErrorSuccess && wins) {
      if (CFGetTypeID(wins) == CFArrayGetTypeID() && CFArrayGetCount((CFArrayRef)wins) > 0) {
        win = CFRetain(CFArrayGetValueAtIndex((CFArrayRef)wins, 0));
      }
      CFRelease(wins);
    }
  }
  if (win) {
    winTitle = ax_string((AXUIElementRef)win, kAXTitleAttribute);
    ax_walk((AXUIElementRef)win, 0, 60, els, &budget, screen);
    CFRelease(win);
  }

  CFTypeRef bar = NULL;
  if (AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute, &bar) == kAXErrorSuccess && bar) {
    int barBudget = 60;
    ax_walk((AXUIElementRef)bar, 0, 1, els, &barBudget, screen);
    CFRelease(bar);
  }
  CFRelease(app);

  NSMutableDictionary *res = [@{
    @"app": front.localizedName ?: @"",
    @"bundle": front.bundleIdentifier ?: @"",
    @"pid": @(pid),
    @"elements": els
  } mutableCopy];
  if (winTitle) res[@"window"] = winTitle;
  emit(res);
  return 0;
}

static CGColorRef mark_color(int i) {
  static const CGFloat palette[][3] = {
    {0.93, 0.17, 0.53}, {0.10, 0.55, 0.95}, {0.98, 0.55, 0.05},
    {0.12, 0.70, 0.35}, {0.58, 0.30, 0.95}, {0.90, 0.20, 0.15}
  };
  const CGFloat *c = palette[i % 6];
  return CGColorCreateGenericRGB(c[0], c[1], c[2], 1.0);
}

static void draw_marks(CGContextRef ctx, const char *file, int outH) {
  NSString *txt = [NSString stringWithContentsOfFile:[NSString stringWithUTF8String:file] encoding:NSUTF8StringEncoding error:nil];
  if (!txt) return;
  CTFontRef font = CTFontCreateWithName(CFSTR("Helvetica-Bold"), 11, NULL);
  int idx = 0;
  for (NSString *line in [txt componentsSeparatedByString:@"\n"]) {
    NSArray *p = [line componentsSeparatedByString:@" "];
    if (p.count < 5) continue;
    NSString *label = p[0];
    CGFloat x = [p[1] doubleValue], y = [p[2] doubleValue], w = [p[3] doubleValue], h = [p[4] doubleValue];
    CGRect box = CGRectMake(x, outH - y - h, w, h);
    CGColorRef color = mark_color(idx++);
    CGContextSetStrokeColorWithColor(ctx, color);
    CGContextSetLineWidth(ctx, 1.5);
    CGContextStrokeRect(ctx, box);

    NSDictionary *attrs = @{ (id)kCTFontAttributeName: (__bridge id)font, (id)kCTForegroundColorFromContextAttributeName: @YES };
    NSAttributedString *as = [[NSAttributedString alloc] initWithString:label attributes:attrs];
    CTLineRef ln = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)as);
    CGFloat ascent = 0, descent = 0;
    double tw = CTLineGetTypographicBounds(ln, &ascent, &descent, NULL);
    CGFloat lw = tw + 6, lh = ascent + descent + 2;
    CGFloat lx = x, ly = (y >= lh) ? (outH - y) : (outH - y - lh);
    CGContextSetFillColorWithColor(ctx, color);
    CGContextFillRect(ctx, CGRectMake(lx, ly, lw, lh));
    CGContextSetRGBFillColor(ctx, 1, 1, 1, 1);
    CGContextSetTextPosition(ctx, lx + 3, ly + descent + 1);
    CTLineDraw(ln, ctx);
    CFRelease(ln);
    CGColorRelease(color);
  }
  CFRelease(font);
}

/* render <in> <out> <outW> <outH> <quality 0-1> <cropX> <cropY> <cropW> <cropH> [marksFile] */
static int cmd_render(int argc, char **argv) {
  if (argc < 11) { fputs("usage: render in out outW outH quality cropX cropY cropW cropH [marks]\n", stderr); return 2; }
  CGImageRef img = load_image(argv[2]);
  if (!img) { fputs("cannot read image\n", stderr); return 2; }
  int outW = atoi(argv[4]), outH = atoi(argv[5]);
  double q = atof(argv[6]);
  CGRect crop = CGRectMake(atof(argv[7]), atof(argv[8]), atof(argv[9]), atof(argv[10]));
  if (crop.size.width >= 1 && crop.size.height >= 1) {
    CGImageRef c = CGImageCreateWithImageInRect(img, crop);
    CGImageRelease(img);
    if (!c) { fputs("crop is outside the image\n", stderr); return 2; }
    img = c;
  }
  if (outW < 1 || outH < 1) { outW = (int)CGImageGetWidth(img); outH = (int)CGImageGetHeight(img); }
  CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
  CGContextRef ctx = CGBitmapContextCreate(NULL, outW, outH, 8, 0, cs, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(cs);
  CGContextSetInterpolationQuality(ctx, kCGInterpolationHigh);
  CGContextDrawImage(ctx, CGRectMake(0, 0, outW, outH), img);
  CGImageRelease(img);
  if (argc > 11 && strlen(argv[11]) > 0) draw_marks(ctx, argv[11], outH);
  CGImageRef res = CGBitmapContextCreateImage(ctx);
  CGContextRelease(ctx);
  NSURL *u = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[3]]];
  CGImageDestinationRef dst = CGImageDestinationCreateWithURL((__bridge CFURLRef)u, CFSTR("public.jpeg"), 1, NULL);
  if (!dst) { CGImageRelease(res); fputs("cannot write image\n", stderr); return 2; }
  CGImageDestinationAddImage(dst, res, (__bridge CFDictionaryRef)@{ (id)kCGImageDestinationLossyCompressionQuality: @(q) });
  BOOL ok = CGImageDestinationFinalize(dst);
  CFRelease(dst);
  CGImageRelease(res);
  if (!ok) { fputs("cannot write image\n", stderr); return 2; }
  printf("%d %d\n", outW, outH);
  return 0;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    const char *cmd = argc > 1 ? argv[1] : "";
    if (strcmp(cmd, "bounds") == 0) return cmd_bounds();
    if (strcmp(cmd, "ocr") == 0 && argc > 2) return cmd_ocr(argv[2], argc > 3 && strcmp(argv[3], "fast") == 0);
    if (strcmp(cmd, "ax") == 0) return cmd_ax(argc > 2 ? atoi(argv[2]) : 0);
    if (strcmp(cmd, "render") == 0) return cmd_render(argc, argv);
    fputs("usage: nimbus-see bounds | ocr <image> [fast] | ax [budget] | render ...\n", stderr);
    return 2;
  }
}
`;

export const SEE_FRAMEWORKS = ["Foundation", "AppKit", "Vision", "ApplicationServices", "ImageIO", "CoreText", "CoreGraphics"];

export function seeCompileArgs(out: string, src: string): string[] {
  return ["-O2", "-fobjc-arc", ...SEE_FRAMEWORKS.flatMap((f) => ["-framework", f]), "-o", out, src];
}

let seeHelper: string | null | undefined;
let seeFailure = "";

/** Path to the perception helper, compiling it on first use. Null when unavailable. */
export async function seeBin(dataDir: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (seeHelper !== undefined) return seeHelper;
  const bundled = process.env.NIMBUS_SEE_BIN;
  if (bundled) {
    try {
      await fs.access(bundled, constants.X_OK);
      seeHelper = bundled;
      return bundled;
    } catch { /* compile locally */ }
  }
  if (!(await commandExists("clang"))) {
    seeFailure = "clang is not installed (run xcode-select --install).";
    seeHelper = null;
    return null;
  }
  const dir = path.join(dataDir, "bin");
  await fs.mkdir(dir, { recursive: true });
  const hash = createHash("sha256").update(SEE_M).digest("hex").slice(0, 12);
  const bin = path.join(dir, `nimbus-see-${hash}`);
  try {
    await fs.access(bin, constants.X_OK);
    seeHelper = bin;
    return bin;
  } catch { /* compile */ }
  const src = path.join(dir, `nimbus-see-${hash}.m`);
  await fs.writeFile(src, SEE_M, "utf8");
  try {
    await run("clang", seeCompileArgs(bin, src), 120_000);
    seeHelper = bin;
    return bin;
  } catch (e) {
    seeFailure = (e as Error).message.slice(0, 300);
    seeHelper = null;
    return null;
  }
}

export function seeUnavailableReason(): string {
  return seeFailure;
}

export async function see(dataDir: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const bin = await seeBin(dataDir);
  if (!bin) throw new ScreenError(`The macOS perception helper is unavailable${seeFailure ? `: ${seeFailure}` : "."}`);
  const { stdout } = await run(bin, args, timeoutMs);
  return stdout.trim();
}
