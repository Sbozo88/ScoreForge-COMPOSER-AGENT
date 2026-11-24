# Build the pinned upstream OMR engine, with its original source available in-image.
FROM eclipse-temurin:25-jdk-noble AS omr
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 5.11.0 https://github.com/Audiveris/audiveris.git /src/audiveris
WORKDIR /src/audiveris
RUN ./gradlew --no-daemon :app:installDist -x test && mkdir -p /opt/audiveris && cp -a app/build/install/app/. /opt/audiveris/

FROM eclipse-temurin:25-jre-noble
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv tesseract-ocr libgomp1 libgl1 libglib2.0-0 libfreetype6 libfontconfig1 fonts-dejavu-core git curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=omr /opt/audiveris /opt/audiveris
COPY --from=omr /src/audiveris /opt/audiveris-source
# MusicXML 4.0 XSD and its local imports are pinned to the standard's release.
RUN git clone --depth 1 --branch v4.0 https://github.com/w3c/musicxml.git /opt/musicxml
RUN mkdir -p /opt/tessdata && for lang in eng lat zul xho sot osd; do curl -fL "https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0/$lang.traineddata" -o "/opt/tessdata/$lang.traineddata"; done
ENV TESSDATA_PREFIX=/opt/tessdata AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris MUSICXML_XSD=/opt/musicxml/schema/musicxml.xsd SCORE_DATA=/data JAVA_TOOL_OPTIONS="-Xmx6g -Djava.awt.headless=true" PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN python3 -m venv /opt/venv
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /srv
COPY *.py /srv/
RUN useradd --create-home --uid 10001 score && mkdir /data && chown score:score /data && /opt/audiveris/bin/Audiveris -help
USER score
EXPOSE 8080
CMD ["sh","-c","uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --limit-concurrency 16"]
