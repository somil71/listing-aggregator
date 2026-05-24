const formatters = {
  success(data, message = 'OK', statusCode = 200) {
    return {
      success: true,
      statusCode,
      message,
      data,
      timestamp: new Date().toISOString()
    };
  },

  error(errorCode, details = null) {
    return {
      success: false,
      statusCode: errorCode.statusCode,
      code: errorCode.code,
      message: errorCode.message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString()
    };
  },

  listing(row) {
    if (!row) return null;
    return {
      id: row.id,
      price: row.price,
      location: row.location,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      area_sqft: row.area_sqft,
      property_type: row.property_type,
      furnished: row.furnished === 1,
      parking: row.parking === 1,
      agent_name: row.agent_name,
      agent_phone: row.agent_phone,
      group_name: row.group_name,
      description: row.description,
      confidence: row.extraction_confidence != null
        ? parseFloat(row.extraction_confidence).toFixed(2)
        : null,
      images: (() => {
        try { return row.image_paths ? JSON.parse(row.image_paths) : []; }
        catch { return []; }
      })(),
      raw_message: row.raw_message || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  },

  pagination(total, limit, offset) {
    const totalPages = Math.ceil(total / limit) || 0;
    return {
      total,
      limit,
      offset,
      total_pages: totalPages,
      current_page: Math.floor(offset / limit) + 1,
      has_more: offset + limit < total
    };
  },

  stats(row) {
    if (!row) return {};
    return {
      count: row.count || 0,
      avg_price: row.avg_price ? Math.round(row.avg_price) : null,
      min_price: row.min_price || null,
      max_price: row.max_price || null,
      avg_bedrooms: row.avg_bedrooms ? parseFloat(row.avg_bedrooms).toFixed(1) : null,
      avg_area: row.avg_area ? Math.round(row.avg_area) : null
    };
  }
};

module.exports = formatters;
