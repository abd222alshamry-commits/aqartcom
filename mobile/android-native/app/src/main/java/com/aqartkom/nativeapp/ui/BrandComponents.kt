package com.aqartkom.nativeapp.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

@Composable
fun BrandMark(modifier: Modifier = Modifier) {
    Surface(modifier, color = Navy, shape = RoundedCornerShape(17.dp)) {
        Icon(Icons.Default.Apartment, null, Modifier.padding(12.dp).size(26.dp), tint = Mint)
    }
}

@Composable
fun FeatureIcon(icon: ImageVector, modifier: Modifier = Modifier, background: Color = MaterialTheme.colorScheme.primaryContainer, tint: Color = MaterialTheme.colorScheme.onPrimaryContainer) {
    Surface(modifier, color = background, shape = RoundedCornerShape(16.dp)) {
        Icon(icon, null, Modifier.padding(12.dp).size(24.dp), tint = tint)
    }
}
