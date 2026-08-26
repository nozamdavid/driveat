package am.noz.atgallery

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.rememberAsyncImagePainter

class MainActivity : ComponentActivity() {
  private val oauthCallback = mutableStateOf<Uri?>(null)
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    oauthCallback.value = intent?.data
    enableEdgeToEdge()
    setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { NativeGalleryScreen(oauthCallback.value) } } }
  }
  override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); oauthCallback.value = intent.data }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeGalleryScreen(callback: Uri?, model: GalleryViewModel = viewModel()) {
  val state by model.state.collectAsState()
  var handle by remember { mutableStateOf("https://spaces-alpha.host.bsky.network") }
  val context = androidx.compose.ui.platform.LocalContext.current
  val requiredPermissions = remember {
    buildList {
      if (Build.VERSION.SDK_INT >= 33) {
        add(Manifest.permission.READ_MEDIA_IMAGES)
        add(Manifest.permission.POST_NOTIFICATIONS)
      } else {
        add(Manifest.permission.READ_EXTERNAL_STORAGE)
      }
    }.toTypedArray()
  }
  val permissionLauncher = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions(),
  ) { permissions ->
    if (permissions[Manifest.permission.READ_MEDIA_IMAGES] == true ||
      permissions[Manifest.permission.READ_EXTERNAL_STORAGE] == true ||
      model.hasMediaPermission()
    ) {
      model.refresh()
    }
  }

  LaunchedEffect(Unit) {
    if (model.hasMediaPermission()) {
      model.refresh()
      if (Build.VERSION.SDK_INT >= 33 &&
        androidx.core.content.ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.POST_NOTIFICATIONS,
        ) != android.content.pm.PackageManager.PERMISSION_GRANTED
      ) {
        permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
      }
    } else {
      permissionLauncher.launch(requiredPermissions)
    }
  }
  LaunchedEffect(callback) { callback?.let(model::finishLogin) }

  Scaffold(
    topBar = {
      TopAppBar(
        title = { Text("AT Storage") },
        actions = {
          if (state.signedInDid != null) {
            TextButton(onClick = model::logout) {
              Text("Log out")
            }
          }
        },
      )
    },
  ) { insets ->
    Column(Modifier.fillMaxSize().padding(insets)) {
      if (state.signedInDid == null) {
        Card(Modifier.fillMaxWidth().padding(16.dp)) {
          Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Connect your AT Protocol account", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
              value = handle,
              onValueChange = { handle = it },
              modifier = Modifier.fillMaxWidth(),
              singleLine = true,
              label = { Text("Handle, DID, or alpha PDS URL") },
            )
            Button(
              enabled = handle.isNotBlank() && !state.authenticating,
              onClick = { model.beginLogin(handle) { url -> context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
            ) { Text(if (state.authenticating) "Connecting…" else "Sign in securely") }
          }
        }
      } else {
        Row(
          Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text("Connected as ${state.signedInDid}", style = MaterialTheme.typography.bodySmall)
        }
      }
      Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
      ) {
        Row(
          Modifier.fillMaxWidth().padding(16.dp),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Column(Modifier.weight(1f)) {
            Text("Native background backup", style = MaterialTheme.typography.titleMedium)
            Text(state.status, style = MaterialTheme.typography.bodyMedium)
          }
          Button(
            onClick = if (state.running) model::stopBackup else model::startBackup,
            enabled = state.running || (state.signedInDid != null && state.scanComplete && !state.scanningRemote),
            colors = if (state.running) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors(),
          ) {
            Icon(if (state.running) Icons.Rounded.Stop else Icons.Rounded.CloudUpload, contentDescription = null)
            Spacer(Modifier.size(8.dp))
            Text(
              if (state.running) "Stop backup"
              else if (state.scanningRemote) "Checking…"
              else "Back up now"
            )
          }
        }
      }

      if (!state.permissionGranted) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Button(onClick = { permissionLauncher.launch(requiredPermissions) }) { Text("Allow photo access") }
        }
      } else {
        Row(
          modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.SpaceBetween,
        ) {
          Text("Hide backed up, skipped & incompatible", style = MaterialTheme.typography.bodyMedium)
          Switch(
            checked = state.hideBackedUpAndIncompatible,
            onCheckedChange = model::setHideBackedUpAndIncompatible,
          )
        }
        val visibleMedia = remember(state.media, state.mediaStatuses, state.hideBackedUpAndIncompatible) {
          if (!state.hideBackedUpAndIncompatible) state.media
          else state.media.filter { media ->
            state.mediaStatuses[media.id] !in setOf(LocalBackupStatus.BACKED_UP, LocalBackupStatus.SKIPPED, LocalBackupStatus.INCOMPATIBLE)
          }
        }
        val dateGroups = remember(visibleMedia) { groupMediaByCaptureDate(visibleMedia) }
        LazyVerticalGrid(
          columns = GridCells.Adaptive(112.dp),
          contentPadding = PaddingValues(8.dp),
          horizontalArrangement = Arrangement.spacedBy(4.dp),
          verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
          dateGroups.forEach { group ->
            item(key = "date-${group.date}", span = { GridItemSpan(maxLineSpan) }) {
              Text(
                group.title,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp),
                style = MaterialTheme.typography.titleMedium,
              )
            }
            items(group.media, key = { it.id }) { media ->
              Box(Modifier.fillMaxWidth().height(112.dp).clip(RoundedCornerShape(8.dp))) {
                Image(
                  painter = rememberAsyncImagePainter(media.uri),
                  contentDescription = media.name,
                  modifier = Modifier.fillMaxSize(),
                  contentScale = ContentScale.Crop,
                )
                state.mediaStatuses[media.id]?.let { status ->
                  val label = when (status) {
                    LocalBackupStatus.INCOMPATIBLE -> "Incompatible"
                    LocalBackupStatus.SKIPPED -> "Skipped"
                    LocalBackupStatus.BACKED_UP -> "Backed up"
                  }
                  Surface(
                    modifier = Modifier.align(Alignment.BottomStart).padding(6.dp),
                    shape = RoundedCornerShape(999.dp),
                    color = Color.Black.copy(alpha = 0.72f),
                    contentColor = Color.White,
                  ) {
                    Text(label, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
