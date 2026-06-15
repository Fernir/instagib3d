export class GLSL {
  static softDepth = `
    uniform sampler2D tex_depth;
    uniform vec4 screen_p; // x=1/w, y=1/h, z=near, w=far (>0 => soft on)
    float soft_depth_fade(float fade_dist)
    {
        if (screen_p.w <= 0.0) return 1.0;
        vec2 suv = gl_FragCoord.xy * screen_p.xy;
        float dz = texture2D(tex_depth, suv).r;
        float nearZ = screen_p.z, farZ = screen_p.w;
        float sndc = dz * 2.0 - 1.0;
        float sceneEye = (2.0 * nearZ * farZ) / (farZ + nearZ - sndc * (farZ - nearZ));
        float fndc = gl_FragCoord.z * 2.0 - 1.0;
        float fragEye = (2.0 * nearZ * farZ) / (farZ + nearZ - fndc * (farZ - nearZ));
        return clamp((sceneEye - fragEye) / fade_dist, 0.0, 1.0);
    }`;

  static fbm2 = `
    float hash12(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }
    float vnoise2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float fbm2(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * vnoise2(p); p *= 2.0; a *= 0.5; }
        return v;
    }`;

  static fbm3 = `
    float hash13(vec3 p)
    {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
    }
    float vnoise3(vec3 x)
    {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash13(i + vec3(0.0,0.0,0.0));
        float n100 = hash13(i + vec3(1.0,0.0,0.0));
        float n010 = hash13(i + vec3(0.0,1.0,0.0));
        float n110 = hash13(i + vec3(1.0,1.0,0.0));
        float n001 = hash13(i + vec3(0.0,0.0,1.0));
        float n101 = hash13(i + vec3(1.0,0.0,1.0));
        float n011 = hash13(i + vec3(0.0,1.0,1.0));
        float n111 = hash13(i + vec3(1.0,1.0,1.0));
        float x00 = mix(n000, n100, f.x);
        float x10 = mix(n010, n110, f.x);
        float x01 = mix(n001, n101, f.x);
        float x11 = mix(n011, n111, f.x);
        float y0 = mix(x00, x10, f.y);
        float y1 = mix(x01, x11, f.y);
        return mix(y0, y1, f.z);
    }
    float fbm3(vec3 p)
    {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) {
            s += a * vnoise3(p);
            p *= 2.03;
            a *= 0.5;
        }
        return s;
    }`;

  static distanceFog(color) {
    return `
    float dist_fog_amount(vec3 wp, vec3 eye)
    {
        // Квадратичная плотность: вблизи прозрачно, вдали быстро растворяет сцену.
        float d = max(0.0, distance(wp, eye) - 4.0);
        float t = 0.02 * d + 0.0045 * d * d;
        return clamp(1.0 - exp(-t), 0.0, 1.0);
    }
    vec3 apply_dist_fog(vec3 col, vec3 wp, vec3 eye)
    {
        float f = dist_fog_amount(wp, eye);
        return mix(col, ${color}, f * 0.96);
    }`;
  }
}
