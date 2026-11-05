const { v2: cloudinary } = require('cloudinary');

const configured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

function uploadBuffer(buffer, options = {}) {
  if (!configured) {
    const error = new Error('Cloudinary storage is not configured.');
    error.code = 'STORAGE_NOT_CONFIGURED';
    return Promise.reject(error);
  }
  const folder = options.folder || 'ravenx';
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: [process.env.CLOUDINARY_FOLDER || 'ravenx', folder].filter(Boolean).join('/'),
      public_id: options.publicId,
      format: options.format,
      type: options.deliveryType || 'upload',
      resource_type: options.resourceType || 'image',
      overwrite: false,
      unique_filename: true
    }, (error, result) => {
      if (error) return reject(error);
      resolve({
        url: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        bytes: result.bytes,
        resourceType: result.resource_type
      });
    });
    stream.end(buffer);
  });
}

function privateDownloadUrl(publicId, format) {
  if (!configured || !publicId || !format) {
    const error = new Error('Private media storage is not configured.');
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: 'image',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 300
  });
}

function deleteAsset(publicId, resourceType = 'image', deliveryType = 'upload') {
  if (!configured || !publicId) return Promise.resolve(null);
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: deliveryType });
}

module.exports = { uploadBuffer, privateDownloadUrl, deleteAsset, storageConfigured: configured };


