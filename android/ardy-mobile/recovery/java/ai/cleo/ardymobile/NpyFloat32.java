package ai.cleo.ardymobile;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/* JADX INFO: loaded from: classes3.dex */
final class NpyFloat32 {
    private static final byte[] MAGIC = {-109, 78, 85, 77, 80, 89};

    private NpyFloat32() {
    }

    static float[] read(InputStream stream) throws IOException {
        int headerLength;
        int dataOffset;
        byte[] bytes = readAll(stream);
        if (bytes.length < 16) {
            throw new IOException("NPY file is too small");
        }
        for (int i = 0; i < MAGIC.length; i++) {
            if (bytes[i] != MAGIC[i]) {
                throw new IOException("Not a NumPy .npy file");
            }
        }
        int major = bytes[6] & 255;
        if (major == 1) {
            headerLength = (bytes[8] & 255) | ((bytes[9] & 255) << 8);
            dataOffset = headerLength + 10;
        } else if (major == 2 || major == 3) {
            headerLength = ((bytes[10] & 255) << 16) | ((bytes[9] & 255) << 8) | (bytes[8] & 255) | ((bytes[11] & 255) << 24);
            dataOffset = headerLength + 12;
        } else {
            throw new IOException("Unsupported NPY version: " + major);
        }
        if (dataOffset > bytes.length) {
            throw new IOException("Invalid NPY header length");
        }
        String header = new String(bytes, dataOffset - headerLength, headerLength, StandardCharsets.US_ASCII);
        if (!header.contains("'descr': '<f4'") && !header.contains("\"descr\": \"<f4\"") && !header.contains("'descr': '|f4'")) {
            throw new IOException("Only little-endian float32 NPY tensors are supported");
        }
        if (!header.contains("4096")) {
            throw new IOException("Expected an embedding width of 4096");
        }
        int floatCount = (bytes.length - dataOffset) / 4;
        if (floatCount != 4096) {
            throw new IOException("Expected 4096 floats, got " + floatCount);
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes, dataOffset, floatCount * 4).order(ByteOrder.LITTLE_ENDIAN);
        float[] values = new float[floatCount];
        for (int i2 = 0; i2 < values.length; i2++) {
            values[i2] = buffer.getFloat();
        }
        return values;
    }

    static float[] read(File file) throws IOException {
        FileInputStream input = new FileInputStream(file);
        try {
            float[] fArr = read(input);
            input.close();
            return fArr;
        } catch (Throwable th) {
            try {
                input.close();
            } catch (Throwable th2) {
                th.addSuppressed(th2);
            }
            throw th;
        }
    }

    static void write(File file, float[] values) throws IOException {
        if (values.length != 4096) {
            throw new IOException("Expected 4096 floats");
        }
        int headerLength = "{'descr': '<f4', 'fortran_order': False, 'shape': (1, 4096), }".length() + 1;
        int padding = 16 - ((10 + headerLength) % 16);
        if (padding == 16) {
            padding = 0;
        }
        StringBuilder padded = new StringBuilder("{'descr': '<f4', 'fortran_order': False, 'shape': (1, 4096), }");
        for (int i = 0; i < padding; i++) {
            padded.append(' ');
        }
        padded.append('\n');
        byte[] headerBytes = padded.toString().getBytes(StandardCharsets.US_ASCII);
        FileOutputStream output = new FileOutputStream(file);
        try {
            output.write(MAGIC);
            output.write(new byte[]{1, 0});
            output.write(headerBytes.length & 255);
            output.write((headerBytes.length >>> 8) & 255);
            output.write(headerBytes);
            ByteBuffer data = ByteBuffer.allocate(values.length * 4).order(ByteOrder.LITTLE_ENDIAN);
            for (float value : values) {
                data.putFloat(value);
            }
            output.write(data.array());
            output.close();
        } catch (Throwable th) {
            try {
                output.close();
            } catch (Throwable th2) {
                th.addSuppressed(th2);
            }
            throw th;
        }
    }

    private static byte[] readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        while (true) {
            int read = stream.read(buffer);
            if (read < 0) {
                return output.toByteArray();
            }
            output.write(buffer, 0, read);
        }
    }
}
