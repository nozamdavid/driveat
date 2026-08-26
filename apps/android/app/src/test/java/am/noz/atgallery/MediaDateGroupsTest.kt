package am.noz.atgallery

import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class MediaDateGroupsTest {
  private val zone = ZoneId.of("Europe/Madrid")
  private val today = LocalDate.of(2026, 8, 24)

  @Test fun groupsByCaptureDateNewestFirst() {
    val oldest = media(1, LocalDate.of(2026, 8, 22), 10)
    val newest = media(2, today, 12)
    val sameDayEarlier = media(3, today, 8)

    val groups = groupByCaptureDate(listOf(oldest, sameDayEarlier, newest), TestMedia::capturedAtMillis, zone, today, Locale.US)

    assertEquals(listOf("Today", "August 22, 2026"), groups.map { it.title })
    assertEquals(listOf(2L, 3L), groups.first().media.map { it.id })
  }

  @Test fun labelsYesterdayRelativeToLocalCaptureDate() {
    val groups = groupByCaptureDate(listOf(media(1, today.minusDays(1), 23)), TestMedia::capturedAtMillis, zone, today, Locale.US)
    assertEquals("Yesterday", groups.single().title)
  }

  private data class TestMedia(val id: Long, val capturedAtMillis: Long)

  private fun media(id: Long, date: LocalDate, hour: Int) = TestMedia(
    id,
    date.atTime(hour, 0).atZone(zone).toInstant().toEpochMilli(),
  )
}
