package de.sekai.stickers;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * 把导出的贴纸图片直接写进系统相册（Pictures/SEKAI贴纸）。
 *
 * 为什么不直接用 @capacitor/filesystem + @capacitor/share：
 * 那套只会把文件写进应用私有缓存再弹分享面板，用户还得自己再点一次「保存到相册」，
 * 而且应用私有目录里的文件不会出现在相册里。
 *
 * 权限：
 *   - Android 10 (API 29) 及以上：用 MediaStore 写入 Pictures 公共集合，属于分存储，
 *     写自己的媒体不需要任何运行时权限，系统也不会弹框。
 *   - Android 9 (API 28) 及以下：只能写公共外部存储目录，必须先拿到
 *     WRITE_EXTERNAL_STORAGE（这里是 Capacitor 的权限流程，会自动弹系统授权框）；
 *     用户拒绝则 reject，由前端回退到分享面板。
 */
@CapacitorPlugin(
    name = "SaveToGallery",
    permissions = {
        @Permission(
            alias = "storage",
            strings = { android.Manifest.permission.WRITE_EXTERNAL_STORAGE }
        )
    }
)
public class SaveToGalleryPlugin extends Plugin {

    /** 相册里显示的子目录名（Android 10+ 由 MediaStore 创建） */
    private static final String ALBUM_DIR = "SEKAI贴纸";

    @PluginMethod
    public void saveImage(PluginCall call) {
        if (needsLegacyStoragePermission()
            && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }
        performSave(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            performSave(call);
        } else {
            call.reject("未获得存储权限，无法保存到相册");
        }
    }

    private void performSave(PluginCall call) {
        String base64 = call.getString("base64");
        String filename = call.getString("filename", "sekai-sticker.png");
        if (base64 == null || base64.length() == 0) {
            call.reject("base64 数据为空");
            return;
        }

        final byte[] bytes;
        try {
            bytes = Base64.decode(stripDataUrl(base64), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("base64 解码失败: " + e.getMessage());
            return;
        }

        try {
            String location;
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                uri = insertWithMediaStore(filename, bytes);
                location = "Pictures/" + ALBUM_DIR + "/" + filename;
            } else {
                File file = writeLegacyFile(filename, bytes);
                uri = Uri.fromFile(file);
                location = file.getAbsolutePath();
            }
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("location", location);
            result.put("filename", filename);
            call.resolve(result);
        } catch (IOException | SecurityException e) {
            call.reject("保存到相册失败: " + e.getMessage());
        }
    }

    private boolean needsLegacyStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P;
    }

    private String stripDataUrl(String data) {
        int comma = data.indexOf(',');
        return comma >= 0 ? data.substring(comma + 1) : data;
    }

    private String mimeTypeFor(String filename) {
        String lower = filename.toLowerCase();
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        return "image/png";
    }

    /** Android 10+：写进 Pictures 公共集合，不需要运行时权限。 */
    private Uri insertWithMediaStore(String filename, byte[] bytes) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeTypeFor(filename));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/" + ALBUM_DIR
            );
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        }
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("MediaStore 未返回可写入的 URI");

        OutputStream out = null;
        try {
            out = resolver.openOutputStream(uri);
            if (out == null) throw new IOException("无法打开输出流");
            out.write(bytes);
            out.flush();
        } finally {
            if (out != null) out.close();
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
        }
        return uri;
    }

    /** Android 9 及以下：直接写公共 Pictures 目录（需 WRITE_EXTERNAL_STORAGE）。 */
    private File writeLegacyFile(String filename, byte[] bytes) throws IOException {
        File dir = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
            ALBUM_DIR
        );
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建目录 " + dir.getAbsolutePath());
        }
        File file = new File(dir, filename);
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(file);
            out.write(bytes);
            out.flush();
        } finally {
            if (out != null) out.close();
        }
        // 让相册立刻能看到这张图
        android.media.MediaScannerConnection.scanFile(
            getContext(),
            new String[] { file.getAbsolutePath() },
            new String[] { mimeTypeFor(filename) },
            null
        );
        return file;
    }
}
