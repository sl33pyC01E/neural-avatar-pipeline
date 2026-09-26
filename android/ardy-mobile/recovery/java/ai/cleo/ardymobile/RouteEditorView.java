package ai.cleo.ardymobile;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.MotionEvent;
import android.view.View;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Locale;
import java.util.function.ToDoubleFunction;

/* JADX INFO: loaded from: classes3.dex */
final class RouteEditorView extends View {
    private Listener listener;
    private final float maxX;
    private final float maxZ;
    private final float minX;
    private final float minZ;
    private final Paint paint;
    private final ArrayList<Point> points;
    private int selected;

    interface Listener {
        void onRouteChanged();
    }

    static final class Point {
        float time;
        float x;
        float z;

        Point(float time, float x, float z) {
            this.time = time;
            this.x = x;
            this.z = z;
        }
    }

    RouteEditorView(Context context) {
        super(context);
        this.points = new ArrayList<>();
        this.paint = new Paint(1);
        this.selected = -1;
        this.minX = -1.5f;
        this.maxX = 1.5f;
        this.minZ = -0.25f;
        this.maxZ = 2.5f;
        setMinimumHeight(dp(260));
        setRoute(ArdyRoute.stationary());
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    void setRoute(ArdyRoute route) {
        this.points.clear();
        float[] values = route.timeXz;
        for (int i = 3; i < values.length; i += 3) {
            this.points.add(new Point(values[i], values[i + 1], values[i + 2]));
        }
        sortPoints();
        invalidate();
    }

    ArrayList<Point> snapshotPoints() {
        ArrayList<Point> copy = new ArrayList<>();
        for (Point point : this.points) {
            copy.add(new Point(point.time, point.x, point.z));
        }
        Collections.sort(copy, Comparator.comparingDouble(new ToDoubleFunction() { // from class: ai.cleo.ardymobile.RouteEditorView$$ExternalSyntheticLambda0
            @Override // java.util.function.ToDoubleFunction
            public final double applyAsDouble(Object obj) {
                return ((RouteEditorView.Point) obj).time;
            }
        }));
        return copy;
    }

    void updateTime(int originalIndex, float time) {
        if (originalIndex < 0 || originalIndex >= this.points.size()) {
            return;
        }
        this.points.get(originalIndex).time = clamp(time, 0.05f, 9.95f);
        sortPoints();
        notifyChanged();
    }

    void updateTimes(float[] times) {
        if (times == null) {
            return;
        }
        sortPoints();
        int count = Math.min(times.length, this.points.size());
        for (int i = 0; i < count; i++) {
            this.points.get(i).time = clamp(times[i], 0.05f, 9.95f);
        }
        sortPoints();
        notifyChanged();
    }

    void removePoint(int originalIndex) {
        if (originalIndex < 0 || originalIndex >= this.points.size()) {
            return;
        }
        this.points.remove(originalIndex);
        if (this.points.isEmpty()) {
            this.points.add(new Point(1.6f, 0.0f, 0.0f));
        }
        this.selected = -1;
        sortPoints();
        notifyChanged();
    }

    ArdyRoute route() {
        sortPoints();
        float[] values = new float[(this.points.size() + 1) * 3];
        values[0] = 0.0f;
        values[1] = 0.0f;
        values[2] = 0.0f;
        int out = 3;
        for (Point point : this.points) {
            int out2 = out + 1;
            values[out] = point.time;
            int out3 = out2 + 1;
            values[out2] = point.x;
            values[out3] = point.z;
            out = out3 + 1;
        }
        return ArdyRoute.fromTimeXz("manual root path", values);
    }

    @Override // android.view.View
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();
        int left = dp(18);
        int right = w - dp(12);
        int top = dp(12);
        int bottom = h - dp(18);
        this.paint.setStyle(Paint.Style.FILL);
        this.paint.setColor(Color.rgb(19, 24, 29));
        canvas.drawRect(0.0f, 0.0f, w, h, this.paint);
        this.paint.setStrokeWidth(dp(1));
        this.paint.setColor(Color.rgb(45, 63, 70));
        for (float x = -1.5f; x <= 1.51f; x += 0.25f) {
            float sx = screenX(x, left, right);
            canvas.drawLine(sx, top, sx, bottom, this.paint);
        }
        for (float z = -0.25f; z <= 2.51f; z += 0.25f) {
            float sy = screenZ(z, top, bottom);
            canvas.drawLine(left, sy, right, sy, this.paint);
        }
        this.paint.setStrokeWidth(dp(2));
        this.paint.setColor(Color.rgb(86, 125, 132));
        canvas.drawLine(screenX(0.0f, left, right), top, screenX(0.0f, left, right), bottom, this.paint);
        canvas.drawLine(left, screenZ(0.0f, top, bottom), right, screenZ(0.0f, top, bottom), this.paint);
        ArrayList<Point> sorted = snapshotPoints();
        this.paint.setStrokeWidth(dp(4));
        this.paint.setColor(Color.rgb(219, 158, 66));
        float lastX = screenX(0.0f, left, right);
        float lastY = screenZ(0.0f, top, bottom);
        float lastX2 = lastX;
        float lastY2 = lastY;
        for (Point point : sorted) {
            float sx2 = screenX(point.x, left, right);
            float sy2 = screenZ(point.z, top, bottom);
            canvas.drawLine(lastX2, lastY2, sx2, sy2, this.paint);
            lastX2 = sx2;
            lastY2 = sy2;
        }
        drawPoint(canvas, screenX(0.0f, left, right), screenZ(0.0f, top, bottom), "0", Color.rgb(126, 214, 168));
        for (int i = 0; i < sorted.size(); i++) {
            Point point2 = sorted.get(i);
            drawPoint(canvas, screenX(point2.x, left, right), screenZ(point2.z, top, bottom), String.valueOf(i + 1), Color.rgb(238, 196, 99));
        }
        this.paint.setStyle(Paint.Style.FILL);
        this.paint.setTextSize(dp(11));
        this.paint.setColor(Color.rgb(157, 171, 184));
        canvas.drawText(String.format(Locale.US, "x %.1f..%.1f   z %.1f..%.1f", Float.valueOf(-1.5f), Float.valueOf(1.5f), Float.valueOf(-0.25f), Float.valueOf(2.5f)), left, h - dp(4), this.paint);
    }

    @Override // android.view.View
    public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == 0) {
            getParent().requestDisallowInterceptTouchEvent(true);
            this.selected = nearestPoint(event.getX(), event.getY());
            if (this.selected < 0) {
                float[] world = world(event.getX(), event.getY());
                this.points.add(new Point(defaultNextTime(), world[0], world[1]));
                this.selected = this.points.size() - 1;
                notifyChanged();
            }
            return true;
        }
        if (action == 2 && this.selected >= 0 && this.selected < this.points.size()) {
            float[] world2 = world(event.getX(), event.getY());
            Point point = this.points.get(this.selected);
            point.x = world2[0];
            point.z = world2[1];
            notifyChanged();
            return true;
        }
        if (action != 1 && action != 3) {
            return true;
        }
        getParent().requestDisallowInterceptTouchEvent(false);
        this.selected = -1;
        return true;
    }

    private void drawPoint(Canvas canvas, float x, float y, String label, int color) {
        this.paint.setStyle(Paint.Style.FILL);
        this.paint.setColor(color);
        canvas.drawCircle(x, y, dp(16), this.paint);
        this.paint.setStyle(Paint.Style.STROKE);
        this.paint.setStrokeWidth(dp(2));
        this.paint.setColor(Color.rgb(13, 17, 21));
        canvas.drawCircle(x, y, dp(16), this.paint);
        this.paint.setStyle(Paint.Style.FILL);
        this.paint.setColor(Color.rgb(13, 17, 21));
        this.paint.setTextSize(dp(13));
        this.paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText(label, x, dp(4) + y, this.paint);
        this.paint.setTextAlign(Paint.Align.LEFT);
    }

    private int nearestPoint(float sx, float sy) {
        int left = dp(18);
        int right = getWidth() - dp(12);
        int top = dp(12);
        int bottom = getHeight() - dp(18);
        float best = dp(22) * dp(22);
        int index = -1;
        for (int i = 0; i < this.points.size(); i++) {
            Point point = this.points.get(i);
            float dx = screenX(point.x, left, right) - sx;
            float dy = screenZ(point.z, top, bottom) - sy;
            float dist = (dx * dx) + (dy * dy);
            if (dist < best) {
                best = dist;
                index = i;
            }
        }
        return index;
    }

    private float[] world(float sx, float sy) {
        int left = dp(18);
        int right = getWidth() - dp(12);
        int top = dp(12);
        int bottom = getHeight() - dp(18);
        float x = (((clamp(sx, left, right) - left) / Math.max(1.0f, right - left)) * 3.0f) - 1.5f;
        float z = (((bottom - clamp(sy, top, bottom)) / Math.max(1.0f, bottom - top)) * 2.75f) - 0.25f;
        return new float[]{round2(x), round2(z)};
    }

    private float defaultNextTime() {
        float max = 0.0f;
        for (Point point : this.points) {
            max = Math.max(max, point.time);
        }
        return Math.min(9.95f, 0.8f + max);
    }

    private float screenX(float x, int left, int right) {
        return left + (((clamp(x, -1.5f, 1.5f) - (-1.5f)) / 3.0f) * (right - left));
    }

    private float screenZ(float z, int top, int bottom) {
        return bottom - (((clamp(z, -0.25f, 2.5f) - (-0.25f)) / 2.75f) * (bottom - top));
    }

    private void notifyChanged() {
        sortPoints();
        invalidate();
        if (this.listener != null) {
            this.listener.onRouteChanged();
        }
    }

    private void sortPoints() {
        Collections.sort(this.points, Comparator.comparingDouble(new ToDoubleFunction() { // from class: ai.cleo.ardymobile.RouteEditorView$$ExternalSyntheticLambda1
            @Override // java.util.function.ToDoubleFunction
            public final double applyAsDouble(Object obj) {
                return ((RouteEditorView.Point) obj).time;
            }
        }));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static float round2(float value) {
        return Math.round(value * 100.0f) / 100.0f;
    }
}
