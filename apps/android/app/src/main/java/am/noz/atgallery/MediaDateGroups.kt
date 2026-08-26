package am.noz.atgallery

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

data class MediaDateGroup<T>(val date: LocalDate, val title: String, val media: List<T>)

fun <T> groupByCaptureDate(
  media: List<T>,
  capturedAtMillis: (T) -> Long,
  zoneId: ZoneId = ZoneId.systemDefault(),
  today: LocalDate = LocalDate.now(zoneId),
  locale: Locale = Locale.getDefault(),
): List<MediaDateGroup<T>> {
  val formatter = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
  return media
    .groupBy { Instant.ofEpochMilli(capturedAtMillis(it)).atZone(zoneId).toLocalDate() }
    .toSortedMap(compareByDescending { it })
    .map { (date, items) ->
      val title = when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> date.format(formatter)
      }
      MediaDateGroup(date, title, items.sortedByDescending(capturedAtMillis))
    }
}

fun groupMediaByCaptureDate(media: List<LocalMedia>): List<MediaDateGroup<LocalMedia>> =
  groupByCaptureDate(media, LocalMedia::capturedAtMillis)
